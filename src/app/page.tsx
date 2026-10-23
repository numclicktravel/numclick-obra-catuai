"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Calendar,
  Lock,
  Unlock,
  Plus,
  Trash2,
  Link2,
  ChevronRight,
  ChevronDown,
  Diamond,
  RotateCcw,
  FolderPlus,
  Cloud,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  LogOut,
  ShieldCheck,
  Eye,
  Search,
} from "lucide-react";

export interface ScheduleTask {
  id: string;
  wbs: string;
  name: string;
  type: "group" | "task" | "milestone";
  parentId: string | null;
  category: string;
  responsible: string;
  supplier: string;
  startDate: string;
  endDate: string;
  dependencyType: "parallel" | "mandatory";
  predecessorId: string | null;
  expanded?: boolean;
}

const parseDate = (str: string) => {
  if (!str) return new Date(2026, 9, 27);
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const formatDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const formatBR = (str: string) => {
  if (!str) return "-";
  const [, m, d] = str.split("-");
  return `${d}/${m}`;
};

const addDays = (str: string, days: number) => {
  const d = parseDate(str);
  d.setDate(d.getDate() + days);
  return formatDate(d);
};

const diffDays = (startStr: string, endStr: string) => {
  const s = parseDate(startStr);
  const e = parseDate(endStr);
  return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
};

const SUGGESTED_CATEGORIES = [
  "Elétrica",
  "Pintura",
  "Vitrine",
  "Movelaria",
  "Fachada",
  "Limpeza de Obra",
  "ADM Shopping",
  "Demolição",
  "Piso e Revestimento",
  "Gesso e Forro",
  "Ar Condicionado",
  "Comunicação Visual",
  "TI e Cabeamento",
];

const INITIAL_EMPTY_TASKS: ScheduleTask[] = [
  {
    id: "g-1",
    wbs: "1",
    name: "",
    type: "group",
    parentId: null,
    category: "",
    responsible: "",
    supplier: "",
    startDate: "2026-10-27",
    endDate: "2026-10-27",
    dependencyType: "parallel",
    predecessorId: null,
    expanded: true,
  },
  {
    id: "t-1",
    wbs: "1.1",
    name: "",
    type: "task",
    parentId: "g-1",
    category: "",
    responsible: "",
    supplier: "",
    startDate: "2026-10-27",
    endDate: "2026-10-28",
    dependencyType: "parallel",
    predecessorId: null,
  },
];

// Motor de recálculo de datas e dependências (Roll-up & Efeito Cascata)
const recalculateSchedule = (rawTasks: ScheduleTask[]): ScheduleTask[] => {
  const updated = rawTasks.map((t) => ({ ...t }));
  const validIds = new Set(updated.map((t) => t.id));

  updated.forEach((t) => {
    if (t.predecessorId && !validIds.has(t.predecessorId)) {
      t.predecessorId = null;
      t.dependencyType = "parallel";
    }
  });

  for (let pass = 0; pass < 15; pass++) {
    let changed = false;
    updated.forEach((task) => {
      if (task.type === "group") return;
      if (task.dependencyType === "mandatory" && task.predecessorId) {
        const pred = updated.find((p) => p.id === task.predecessorId);
        if (pred && pred.endDate) {
          const minStart = addDays(pred.endDate, 1);
          if (task.startDate !== minStart) {
            const duration =
              task.type === "milestone"
                ? 0
                : Math.max(0, diffDays(task.startDate, task.endDate));
            task.startDate = minStart;
            task.endDate = addDays(minStart, duration);
            changed = true;
          }
        }
      }
      if (task.type === "milestone" && task.endDate !== task.startDate) {
        task.endDate = task.startDate;
        changed = true;
      }
    });
    if (!changed) break;
  }

  updated.forEach((group) => {
    if (group.type === "group") {
      const children = updated.filter((t) => t.parentId === group.id);
      if (children.length > 0) {
        const minStart = children.reduce(
          (min, c) => (c.startDate < min ? c.startDate : min),
          children[0].startDate
        );
        const maxEnd = children.reduce(
          (max, c) => (c.endDate > max ? c.endDate : max),
          children[0].endDate
        );
        group.startDate = minStart;
        group.endDate = maxEnd;
      }
    }
  });

  return updated;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [passwordInput, setPasswordInput] = useState<string>("");
  const [authError, setAuthError] = useState<string>("");

  const [tasks, setTasks] = useState<ScheduleTask[]>(INITIAL_EMPTY_TASKS);
  const [searchFilter, setSearchFilter] = useState<string>("");

  // Estado de sincronização com Neon PostgreSQL
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<"saved" | "saving" | "error">("saved");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const isDirtyRef = useRef<boolean>(false);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Recupera sessão salva no navegador
  useEffect(() => {
    try {
      const savedRole = sessionStorage.getItem("numclick_catuai_role");
      const savedAdmin = sessionStorage.getItem("numclick_catuai_admin");
      if (savedRole === "admin" && savedAdmin === "true") {
        setIsAuthenticated(true);
        setIsAdminUnlocked(true);
        setRole("admin");
      } else if (savedRole === "viewer") {
        setIsAuthenticated(true);
        setRole("viewer");
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const fetchScheduleFromCloud = useCallback(async (silent = false) => {
    if (isDirtyRef.current) return;
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      if (!res.ok) throw new Error("Falha ao buscar cronograma");
      const data = await res.json();
      if (data.ok && Array.isArray(data.tasks)) {
        if (!isDirtyRef.current) {
          setTasks(recalculateSchedule(data.tasks));
          setLastUpdatedAt(data.updatedAt || new Date().toISOString());
        }
      }
    } catch (err) {
      console.error("Erro ao sincronizar cronograma:", err);
      if (!silent) setSyncStatus("error");
    } finally {
      if (!silent) setIsLoadingInitial(false);
    }
  }, []);

  const saveScheduleToCloud = useCallback(async (tasksToSave: ScheduleTask[]) => {
    setSyncStatus("saving");
    try {
      const recalculated = recalculateSchedule(tasksToSave);
      const res = await fetch("/api/schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tasks: recalculated }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      const data = await res.json();
      if (data.ok) {
        isDirtyRef.current = false;
        setSyncStatus("saved");
        setLastUpdatedAt(data.updatedAt || new Date().toISOString());
      } else {
        setSyncStatus("error");
      }
    } catch (err) {
      console.error("Erro ao salvar no Neon:", err);
      setSyncStatus("error");
    }
  }, []);

  // Carrega dados na inicialização e faz polling em tempo real para visualização compartilhada
  useEffect(() => {
    fetchScheduleFromCloud(false);
    const interval = setInterval(() => {
      if (!isDirtyRef.current) {
        fetchScheduleFromCloud(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchScheduleFromCloud]);

  // Helper que atualiza o estado local e agenda persistência automática no Neon
  const applyTasksUpdate = useCallback(
    (updater: (prev: ScheduleTask[]) => ScheduleTask[]) => {
      if (role !== "admin") return;
      isDirtyRef.current = true;
      setSyncStatus("saving");
      setTasks((prev) => {
        const next = recalculateSchedule(updater(prev));
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveScheduleToCloud(next);
        }, 500);
        return next;
      });
    },
    [role, saveScheduleToCloud]
  );

  const computedTasks = useMemo(() => recalculateSchedule(tasks), [tasks]);

  const timelineDays = useMemo(() => {
    const startStr = "2026-10-27";
    let maxEndStr = "2026-11-16";
    computedTasks.forEach((t) => {
      if (t.endDate && t.endDate > maxEndStr) maxEndStr = t.endDate;
    });
    const totalDays = Math.max(21, diffDays(startStr, maxEndStr) + 4);
    const days = [];
    const weekDaysPT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

    for (let i = 0; i < totalDays; i++) {
      const dateStr = addDays(startStr, i);
      const dObj = parseDate(dateStr);
      const dow = dObj.getDay();
      days.push({
        dateStr,
        dayNumber: String(dObj.getDate()).padStart(2, "0"),
        monthNumber: String(dObj.getMonth() + 1).padStart(2, "0"),
        dayName: weekDaysPT[dow],
        isWeekend: dow === 0 || dow === 6,
        weekIndex: Math.floor(i / 7) + 1,
      });
    }
    return days;
  }, [computedTasks]);

  const weeksHeader = useMemo(() => {
    const map: Record<number, { weekIndex: number; count: number }> = {};
    timelineDays.forEach((d) => {
      if (!map[d.weekIndex]) map[d.weekIndex] = { weekIndex: d.weekIndex, count: 0 };
      map[d.weekIndex].count += 1;
    });
    return Object.values(map);
  }, [timelineDays]);

  const updateField = (id: string, field: keyof ScheduleTask, value: any) => {
    if (role !== "admin") return;
    applyTasksUpdate((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const updated: ScheduleTask = { ...t, [field]: value };
        if (field === "startDate" && updated.endDate < value) updated.endDate = value;
        if (field === "endDate" && value < updated.startDate) updated.startDate = value;
        if (field === "type" && value === "milestone") updated.endDate = updated.startDate;
        if (field === "dependencyType" && value === "parallel") updated.predecessorId = null;
        return updated;
      })
    );
  };

  const addParentGroup = () => {
    if (role !== "admin") return;
    const groupCount = computedTasks.filter((t) => t.type === "group").length + 1;
    const newGroupId = `g-${Date.now()}`;
    const newSubTaskId = `t-${Date.now() + 1}`;
    applyTasksUpdate((prev) => [
      ...prev,
      {
        id: newGroupId,
        wbs: `${groupCount}`,
        name: "",
        type: "group",
        parentId: null,
        category: "",
        responsible: "",
        supplier: "",
        startDate: "2026-10-27",
        endDate: "2026-10-27",
        dependencyType: "parallel",
        predecessorId: null,
        expanded: true,
      },
      {
        id: newSubTaskId,
        wbs: `${groupCount}.1`,
        name: "",
        type: "task",
        parentId: newGroupId,
        category: "",
        responsible: "",
        supplier: "",
        startDate: "2026-10-27",
        endDate: "2026-10-28",
        dependencyType: "parallel",
        predecessorId: null,
      },
    ]);
  };

  const addSubTask = (parentId: string) => {
    if (role !== "admin") return;
    const parent = computedTasks.find((t) => t.id === parentId);
    const siblings = computedTasks.filter((t) => t.parentId === parentId);
    const nextIdx = siblings.length + 1;
    const lastSibling = siblings[siblings.length - 1];
    const defaultStart = lastSibling ? lastSibling.endDate : "2026-10-27";

    const newTask: ScheduleTask = {
      id: `t-${Date.now()}`,
      wbs: parent && parent.wbs ? `${parent.wbs}.${nextIdx}` : `${nextIdx}`,
      name: "",
      type: "task",
      parentId,
      category: parent?.category || "",
      responsible: "",
      supplier: "",
      startDate: defaultStart,
      endDate: defaultStart,
      dependencyType: "parallel",
      predecessorId: null,
    };

    applyTasksUpdate((prev) => {
      const updatedParent = prev.map((t) =>
        t.id === parentId ? { ...t, expanded: true } : t
      );
      const idx = updatedParent.findIndex(
        (t) => t.id === (lastSibling ? lastSibling.id : parentId)
      );
      const copy = [...updatedParent];
      copy.splice(idx + 1, 0, newTask);
      return copy;
    });
  };

  const deleteRow = (id: string) => {
    if (role !== "admin") return;
    applyTasksUpdate((prev) => {
      const removedIds = new Set<string>([id]);
      prev.forEach((t) => {
        if (t.parentId === id) removedIds.add(t.id);
      });
      return prev
        .filter((t) => !removedIds.has(t.id))
        .map((t) =>
          t.predecessorId && removedIds.has(t.predecessorId)
            ? { ...t, predecessorId: null, dependencyType: "parallel" }
            : t
        );
    });
  };

  const clearAllSchedule = () => {
    if (role !== "admin") return;
    if (window.confirm("Deseja apagar todas as linhas e reiniciar o cronograma em branco?")) {
      applyTasksUpdate(() => INITIAL_EMPTY_TASKS);
    }
  };

  const toggleExpand = (groupId: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === groupId ? { ...t, expanded: !t.expanded } : t))
    );
  };

  const orderedRows = useMemo(() => {
    const groups = computedTasks.filter((t) => t.type === "group");
    const result: ScheduleTask[] = [];
    groups.forEach((g) => {
      const children = computedTasks.filter((c) => c.parentId === g.id);
      const matchSearch = (item: ScheduleTask) => {
        if (!searchFilter.trim()) return true;
        const q = searchFilter.toLowerCase();
        return (
          (item.wbs || "").toLowerCase().includes(q) ||
          (item.name || "").toLowerCase().includes(q) ||
          (item.category || "").toLowerCase().includes(q) ||
          (item.responsible || "").toLowerCase().includes(q) ||
          (item.supplier || "").toLowerCase().includes(q)
        );
      };
      const matchingChildren = children.filter(matchSearch);
      if (matchSearch(g) || matchingChildren.length > 0) {
        result.push(g);
        if (g.expanded !== false) {
          children.forEach((c) => {
            if (!searchFilter.trim() || matchSearch(c) || matchSearch(g)) {
              result.push(c);
            }
          });
        }
      }
    });
    return result;
  }, [computedTasks, searchFilter]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPwd = passwordInput.trim();
    if (cleanPwd === "admin-numclick") {
      setRole("admin");
      setIsAdminUnlocked(true);
      setIsAuthenticated(true);
      setShowAuthModal(false);
      setPasswordInput("");
      setAuthError("");
      try {
        sessionStorage.setItem("numclick_catuai_role", "admin");
        sessionStorage.setItem("numclick_catuai_admin", "true");
      } catch {}
    } else if (cleanPwd === "catuai2026") {
      setRole("viewer");
      setIsAuthenticated(true);
      setShowAuthModal(false);
      setPasswordInput("");
      setAuthError("");
      try {
        sessionStorage.setItem("numclick_catuai_role", "viewer");
      } catch {}
    } else {
      setAuthError('Senha incorreta. Verifique sua credencial de acesso.');
    }
  };

  const handleSwitchMode = (targetRole: "admin" | "viewer") => {
    if (targetRole === "viewer") {
      setRole("viewer");
      try {
        sessionStorage.setItem("numclick_catuai_role", "viewer");
      } catch {}
    } else {
      if (isAdminUnlocked) {
        setRole("admin");
        try {
          sessionStorage.setItem("numclick_catuai_role", "admin");
        } catch {}
      } else {
        setAuthError("");
        setPasswordInput("");
        setShowAuthModal(true);
      }
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setIsAdminUnlocked(false);
    setRole("viewer");
    setPasswordInput("");
    setAuthError("");
    try {
      sessionStorage.removeItem("numclick_catuai_role");
      sessionStorage.removeItem("numclick_catuai_admin");
    } catch {}
  };

  // Tela de Login Institucional da NUM CLICK VIAGENS
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-amber-500/10 via-slate-950 to-slate-950 pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-7 relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-amber-500 text-slate-950 font-black px-3 py-1.5 rounded-lg text-sm tracking-tight shadow-sm">
              NUM CLICK
            </div>
            <div>
              <h1 className="text-white font-bold text-base leading-tight">
                NUM CLICK VIAGENS
              </h1>
              <p className="text-xs text-slate-400">
                Cronograma Executivo de Obra • Shopping Catuaí
              </p>
            </div>
          </div>

          <div className="bg-slate-800/60 border border-slate-700/70 rounded-xl p-3.5 mb-5 text-xs text-slate-300 space-y-1">
            <div className="font-semibold text-white flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-400" />
              Portal de Acompanhamento e Gestão de Reforma
            </div>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Insira a senha correspondente ao seu perfil de acesso (Administração Shopping Catuaí / Fornecedores ou Engenharia / Admin Num Click).
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha de Acesso
              </label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (authError) setAuthError("");
                }}
                placeholder="Digite sua senha de acesso..."
                className="w-full text-sm px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                autoFocus
              />
              {authError && (
                <p className="text-xs text-rose-400 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {authError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs py-2.5 rounded-xl transition shadow-md"
            >
              Acessar Cronograma da Obra
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-slate-400" />
              Visualização (Shopping / Fornecedores)
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Gestão Num Click
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <datalist id="execution-groups">
        {SUGGESTED_CATEGORIES.map((cat) => (
          <option key={cat} value={cat} />
        ))}
      </datalist>

      {/* Top Header */}
      <header className="bg-slate-900 text-white px-5 py-3 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="bg-amber-500 text-slate-950 font-black px-2.5 py-1 rounded text-sm tracking-tight">
            NUM CLICK
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">
              Cronograma de Obra — Shopping Catuaí
            </h1>
            <p className="text-xs text-slate-400">
              Início: 27/10/2026 • Visão Horizontal Diária
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status de Sincronização em Nuvem (Neon) */}
          <div className="flex items-center gap-1.5 bg-slate-800/90 border border-slate-700 px-2.5 py-1 rounded-lg text-[11px]">
            {isLoadingInitial ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span className="text-slate-300">Carregando nuvem...</span>
              </>
            ) : syncStatus === "saving" ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span className="text-amber-300">Salvando no Neon...</span>
              </>
            ) : syncStatus === "error" ? (
              <button
                onClick={() =>
                  role === "admin"
                    ? saveScheduleToCloud(tasks)
                    : fetchScheduleFromCloud(false)
                }
                className="flex items-center gap-1 text-rose-400 hover:underline"
              >
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Erro na nuvem (Tentar novamente)</span>
              </button>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-300">Sincronizado em tempo real</span>
              </>
            )}
          </div>

          {/* Seletor de Perfil */}
          <div className="bg-slate-800 p-1 rounded-lg flex items-center text-xs border border-slate-700">
            <button
              onClick={() => handleSwitchMode("admin")}
              className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 transition ${
                role === "admin"
                  ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Unlock className="w-3 h-3" />
              Modo Edição
            </button>
            <button
              onClick={() => handleSwitchMode("viewer")}
              className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 transition ${
                role === "viewer"
                  ? "bg-amber-500 text-slate-950 font-semibold shadow-sm"
                  : "text-slate-300 hover:text-white"
              }`}
            >
              <Lock className="w-3 h-3" />
              Modo Leitura
            </button>
          </div>

          <button
            onClick={() => {
              setAuthError("");
              setPasswordInput("");
              setShowAuthModal(true);
            }}
            className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-200 transition"
          >
            Trocar Senha
          </button>

          <button
            onClick={handleLogout}
            title="Sair"
            className="text-xs bg-slate-800 hover:bg-rose-950/70 hover:border-rose-700 border border-slate-700 p-1.5 rounded-lg text-slate-300 hover:text-rose-200 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Action Sub-bar */}
      <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {role === "admin" ? (
            <>
              <button
                onClick={addParentGroup}
                className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 shadow-sm transition"
              >
                <FolderPlus className="w-4 h-4 text-amber-400" /> + Novo Grupo Pai
              </button>
              <button
                onClick={clearAllSchedule}
                className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Zerar
              </button>
              <button
                onClick={() => saveScheduleToCloud(tasks)}
                className="bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 transition"
              >
                <Cloud className="w-3.5 h-3.5" /> Salvar Agora
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-600 bg-amber-50 border border-amber-200/80 px-3 py-1.5 rounded-lg">
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>
                <strong>Visualização Somente Leitura</strong> — Administração Shopping Catuaí & Fornecedores
              </span>
            </div>
          )}

          {/* Legenda rápida */}
          <div className="hidden lg:flex items-center gap-3 ml-3 pl-3 border-l border-slate-200 text-[11px] text-slate-600">
            <span className="flex items-center gap-1">
              <span className="w-3 h-2.5 rounded-sm bg-slate-800 inline-block" /> Grupo Pai (Auto Roll-up)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2.5 rounded-sm bg-sky-600 inline-block" /> Etapa Paralela
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2.5 rounded-sm bg-rose-600 inline-block" /> Etapa Mandatória (Cascata)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rotate-45 bg-amber-500 border border-slate-900 inline-block" /> Marco (Milestone)
            </span>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filtrar etapa, grupo, responsável, fornecedor..."
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg w-72 focus:outline-none focus:border-slate-500"
          />
        </div>
      </div>

      {/* Main Split-Screen Horizontal Gantt Table */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-max">
          {/* Sticky Header */}
          <div className="flex sticky top-0 z-20 bg-slate-100 border-b border-slate-300 text-xs font-semibold text-slate-700">
            <div className="sticky left-0 z-30 flex bg-slate-100 border-r-2 border-slate-300 shadow-sm">
              <div className="w-80 px-3 py-2 border-r border-slate-200 flex items-center">
                1. Etapas e Sub-etapas
              </div>
              <div className="w-40 px-2.5 py-2 border-r border-slate-200 flex items-center">
                2. Grupo Execução
              </div>
              <div className="w-36 px-2.5 py-2 border-r border-slate-200 flex items-center">
                3. Responsável
              </div>
              <div className="w-36 px-2.5 py-2 border-r border-slate-200 flex items-center">
                4. Fornecedor
              </div>
              <div className="w-60 px-2.5 py-2 border-r border-slate-200 flex items-center">
                Datas & Vínculo
              </div>
            </div>

            <div className="flex flex-col">
              <div className="flex border-b border-slate-200 bg-slate-200/70">
                {weeksHeader.map((w) => (
                  <div
                    key={w.weekIndex}
                    style={{ width: `${w.count * 40}px` }}
                    className="text-center py-1 text-[11px] font-bold text-slate-700 border-r border-slate-300"
                  >
                    Semana {w.weekIndex}
                  </div>
                ))}
              </div>
              <div className="flex">
                {timelineDays.map((d) => (
                  <div
                    key={d.dateStr}
                    className={`w-10 shrink-0 text-center py-1 border-r border-slate-200 ${
                      d.isWeekend
                        ? "bg-slate-200/80 text-slate-500"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    <span className="text-[10px] font-bold block">
                      {d.dayNumber}/{d.monthNumber}
                    </span>
                    <span className="text-[9px]">{d.dayName}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rows */}
          {orderedRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              Nenhuma etapa encontrada.{" "}
              {role === "admin" &&
                'Clique em "+ Novo Grupo Pai" para adicionar etapas ao cronograma.'}
            </div>
          ) : (
            orderedRows.map((row) => {
              const isGroup = row.type === "group";
              const isMilestone = row.type === "milestone";
              const possiblePredecessors = computedTasks.filter(
                (t) => t.type !== "group" && t.id !== row.id
              );
              const predecessorTask = row.predecessorId
                ? computedTasks.find((p) => p.id === row.predecessorId)
                : null;

              return (
                <div
                  key={row.id}
                  className={`flex border-b border-slate-200 ${
                    isGroup
                      ? "bg-slate-100 font-semibold"
                      : "bg-white hover:bg-slate-50/80"
                  }`}
                >
                  {/* Left Fixed Columns */}
                  <div
                    className={`sticky left-0 z-10 flex border-r-2 border-slate-300 ${
                      isGroup ? "bg-slate-100" : "bg-white"
                    }`}
                  >
                    {/* Col 1: WBS & Etapa */}
                    <div className="w-80 px-2 py-1.5 border-r border-slate-200 flex items-center gap-1.5">
                      {isGroup ? (
                        <button
                          onClick={() => toggleExpand(row.id)}
                          className="p-0.5 rounded hover:bg-slate-200 text-slate-600 shrink-0"
                          title={row.expanded !== false ? "Recolher grupo" : "Expandir grupo"}
                        >
                          {row.expanded !== false ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      ) : (
                        <div className="pl-4 shrink-0">
                          {role === "admin" ? (
                            <button
                              onClick={() =>
                                updateField(
                                  row.id,
                                  "type",
                                  isMilestone ? "task" : "milestone"
                                )
                              }
                              title="Alternar entre Tarefa e Marco (Milestone)"
                              className={`p-1 rounded transition ${
                                isMilestone
                                  ? "text-amber-600 bg-amber-50 border border-amber-200"
                                  : "text-slate-300 hover:text-slate-500"
                              }`}
                            >
                              <Diamond className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            isMilestone && (
                              <Diamond className="w-3.5 h-3.5 text-amber-500" />
                            )
                          )}
                        </div>
                      )}

                      {role === "admin" ? (
                        <input
                          type="text"
                          value={row.wbs || ""}
                          onChange={(e) => updateField(row.id, "wbs", e.target.value)}
                          placeholder="WBS"
                          className={`w-10 text-xs px-1 py-0.5 rounded border border-transparent hover:border-slate-300 focus:border-slate-400 focus:bg-white text-center shrink-0 ${
                            isGroup
                              ? "font-bold bg-slate-200/80 text-slate-800"
                              : "text-slate-500 bg-slate-50"
                          }`}
                        />
                      ) : (
                        <span
                          className={`text-xs w-9 text-center shrink-0 ${
                            isGroup ? "font-bold text-slate-800" : "text-slate-500"
                          }`}
                        >
                          {row.wbs}
                        </span>
                      )}

                      {role === "admin" ? (
                        <input
                          type="text"
                          value={row.name || ""}
                          onChange={(e) => updateField(row.id, "name", e.target.value)}
                          placeholder={
                            isGroup ? "Nome do Grupo..." : "Nome da sub-etapa..."
                          }
                          className={`w-full text-xs px-1.5 py-1 rounded border border-slate-200 focus:border-slate-400 focus:outline-none ${
                            isGroup ? "font-bold bg-white" : ""
                          }`}
                        />
                      ) : (
                        <span
                          className={`text-xs flex-1 truncate ${
                            isGroup
                              ? "font-bold text-slate-900"
                              : row.name
                              ? "text-slate-700"
                              : "text-slate-400 italic"
                          }`}
                          title={row.name || ""}
                        >
                          {row.name || "—"}
                        </span>
                      )}

                      {role === "admin" && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          {isGroup && (
                            <button
                              onClick={() => addSubTask(row.id)}
                              title="Adicionar sub-etapa neste grupo"
                              className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteRow(row.id)}
                            title={
                              isGroup
                                ? "Excluir Grupo Pai e suas sub-etapas"
                                : "Excluir linha"
                            }
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Col 2: Grupo de Execução */}
                    <div className="w-40 px-2 py-1.5 border-r border-slate-200 flex items-center">
                      {role === "admin" ? (
                        <input
                          type="text"
                          list="execution-groups"
                          value={row.category || ""}
                          onChange={(e) =>
                            updateField(row.id, "category", e.target.value)
                          }
                          placeholder="Categoria..."
                          className="w-full text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:border-slate-400 focus:outline-none font-normal"
                        />
                      ) : (
                        <span className="text-xs text-slate-700 truncate">
                          {row.category || "-"}
                        </span>
                      )}
                    </div>

                    {/* Col 3: Responsável */}
                    <div className="w-36 px-2 py-1.5 border-r border-slate-200 flex items-center">
                      {role === "admin" ? (
                        <input
                          type="text"
                          value={row.responsible || ""}
                          onChange={(e) =>
                            updateField(row.id, "responsible", e.target.value)
                          }
                          placeholder="Resp..."
                          className="w-full text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:border-slate-400 focus:outline-none font-normal"
                        />
                      ) : (
                        <span className="text-xs text-slate-700 truncate">
                          {row.responsible || "-"}
                        </span>
                      )}
                    </div>

                    {/* Col 4: Fornecedor */}
                    <div className="w-36 px-2 py-1.5 border-r border-slate-200 flex items-center">
                      {role === "admin" ? (
                        <input
                          type="text"
                          value={row.supplier || ""}
                          onChange={(e) =>
                            updateField(row.id, "supplier", e.target.value)
                          }
                          placeholder="Fornecedor..."
                          className="w-full text-xs px-2 py-1 border border-slate-200 rounded bg-white focus:border-slate-400 focus:outline-none font-normal"
                        />
                      ) : (
                        <span className="text-xs text-slate-700 truncate">
                          {row.supplier || "-"}
                        </span>
                      )}
                    </div>

                    {/* Col 5: Datas & Vínculo */}
                    <div className="w-60 px-2 py-1 border-r border-slate-200 flex flex-col justify-center gap-1">
                      {isGroup ? (
                        <div className="flex items-center justify-between text-[11px] text-slate-700 bg-slate-200/90 px-2 py-1 rounded font-bold">
                          <span>
                            {formatBR(row.startDate)} a {formatBR(row.endDate)}
                          </span>
                          <span className="text-[10px] bg-slate-300 px-1.5 py-0.5 rounded text-slate-800">
                            Auto (Pai)
                          </span>
                        </div>
                      ) : role === "admin" ? (
                        <>
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={row.startDate}
                              disabled={
                                row.dependencyType === "mandatory" &&
                                !!row.predecessorId
                              }
                              onChange={(e) =>
                                updateField(row.id, "startDate", e.target.value)
                              }
                              className="text-[11px] px-1 py-0.5 border border-slate-200 rounded w-[108px] disabled:bg-slate-100 disabled:text-slate-400"
                            />
                            <span className="text-slate-400 text-[10px]">→</span>
                            <input
                              type="date"
                              value={row.endDate}
                              min={row.startDate}
                              disabled={isMilestone}
                              onChange={(e) =>
                                updateField(row.id, "endDate", e.target.value)
                              }
                              className="text-[11px] px-1 py-0.5 border border-slate-200 rounded w-[108px] disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <select
                              value={row.dependencyType}
                              onChange={(e) =>
                                updateField(
                                  row.id,
                                  "dependencyType",
                                  e.target.value as "parallel" | "mandatory"
                                )
                              }
                              className="text-[10px] px-1 py-0.5 rounded border border-slate-200 bg-white"
                            >
                              <option value="parallel">⚡ Paralelo</option>
                              <option value="mandatory">🔗 Mandatório</option>
                            </select>
                            {row.dependencyType === "mandatory" && (
                              <select
                                value={row.predecessorId || ""}
                                onChange={(e) =>
                                  updateField(
                                    row.id,
                                    "predecessorId",
                                    e.target.value || null
                                  )
                                }
                                className="text-[10px] px-1 py-0.5 rounded border border-slate-200 bg-white flex-1 truncate"
                              >
                                <option value="">Anterior...</option>
                                {possiblePredecessors.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.wbs || "•"} - {p.name || "(Sem nome)"}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center justify-between text-[11px] text-slate-700">
                          <span>
                            {formatBR(row.startDate)} → {formatBR(row.endDate)}
                          </span>
                          {row.dependencyType === "mandatory" && predecessorTask && (
                            <span
                              className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded flex items-center gap-0.5"
                              title={`Depende de: ${predecessorTask.wbs} ${predecessorTask.name}`}
                            >
                              <Link2 className="w-2.5 h-2.5" />
                              após {predecessorTask.wbs}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right Daily Gantt Bars */}
                  <div className="flex relative">
                    {timelineDays.map((d) => {
                      const inRange =
                        d.dateStr >= row.startDate && d.dateStr <= row.endDate;
                      const isStart = d.dateStr === row.startDate;
                      const isEnd = d.dateStr === row.endDate;

                      return (
                        <div
                          key={d.dateStr}
                          className={`w-10 shrink-0 border-r border-slate-200 flex items-center justify-center ${
                            d.isWeekend ? "bg-slate-100/90" : ""
                          }`}
                        >
                          {inRange &&
                            (isGroup ? (
                              <div
                                className={`h-2.5 w-full bg-slate-800 ${
                                  isStart ? "rounded-l ml-0.5" : ""
                                } ${isEnd ? "rounded-r mr-0.5" : ""}`}
                              />
                            ) : isMilestone ? (
                              <div
                                title={`Marco: ${row.name || row.wbs} (${formatBR(
                                  row.startDate
                                )})`}
                                className="w-4 h-4 rotate-45 bg-amber-500 border border-slate-900 shadow-sm"
                              />
                            ) : (
                              <div
                                title={`${row.wbs ? row.wbs + " - " : ""}${
                                  row.name || "Etapa"
                                }: ${formatBR(row.startDate)} até ${formatBR(
                                  row.endDate
                                )}`}
                                className={`h-5 w-full ${
                                  row.dependencyType === "mandatory"
                                    ? "bg-rose-600"
                                    : "bg-sky-600"
                                } ${isStart ? "rounded-l-md ml-0.5" : ""} ${
                                  isEnd ? "rounded-r-md mr-0.5" : ""
                                }`}
                              />
                            ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal para alternar para Admin / Trocar Senha */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-950/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                Autenticação de Perfil — NUM CLICK
              </h3>
              <button
                onClick={() => setShowAuthModal(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Fechar
              </button>
            </div>
            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (authError) setAuthError("");
                }}
                placeholder="Digite a senha do perfil..."
                className="w-full text-sm px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-slate-600"
                autoFocus
              />
              {authError && <p className="text-xs text-rose-600">{authError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAuthModal(false)}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold py-2 rounded-lg transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 rounded-lg transition"
                >
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
