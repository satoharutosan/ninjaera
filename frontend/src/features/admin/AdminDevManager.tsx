import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import EngineeringIcon from "@mui/icons-material/Engineering";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import { useC, SH1, FilledBtn, OutlinedBtn, Field, Chip } from "@/app/shared";
import {
  api,
  ApiError,
  type DevManagerGoal,
  type DevManagerInstruction,
  type DevManagerOverview,
  type DevManagerRelease,
  type DevManagerReport,
  type DevManagerTask,
} from "@/app/api";
import { StatCard } from "@/features/admin/components/AdminChrome";

type Tab = "overview" | "instructions" | "goals" | "tasks" | "reports" | "releases" | "status";

const TASK_STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminDevManager({
  onConfirm,
}: {
  onConfirm: (c: { title: string; body: string; onOk: () => void }) => void;
}) {
  const C = useC();
  const [tab, setTab] = useState<Tab>("overview");
  const [projectId, setProjectId] = useState("ninja-era");
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<DevManagerOverview | null>(null);
  const [instructions, setInstructions] = useState<DevManagerInstruction[]>([]);
  const [goals, setGoals] = useState<DevManagerGoal[]>([]);
  const [tasks, setTasks] = useState<DevManagerTask[]>([]);
  const [reports, setReports] = useState<DevManagerReport[]>([]);
  const [releases, setReleases] = useState<DevManagerRelease[]>([]);

  const [instTitle, setInstTitle] = useState("");
  const [instBody, setInstBody] = useState("");
  const [instPriority, setInstPriority] = useState<"normal" | "urgent">("normal");

  const [goalTitle, setGoalTitle] = useState("");
  const [goalDesc, setGoalDesc] = useState("");
  const [goalProgress, setGoalProgress] = useState("0");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [taskStatus, setTaskStatus] = useState("todo");
  const [taskPriority, setTaskPriority] = useState("2");
  const [taskMilestone, setTaskMilestone] = useState("");

  const [relVersion, setRelVersion] = useState("");
  const [relUrl, setRelUrl] = useState("");
  const [relNotes, setRelNotes] = useState("");
  const [relChecksum, setRelChecksum] = useState("");
  const [relPublish, setRelPublish] = useState(true);

  const [sprintName, setSprintName] = useState("");
  const [sprintDay, setSprintDay] = useState("1");
  const [sprintTotalDays, setSprintTotalDays] = useState("14");
  const [sprintProgress, setSprintProgress] = useState("0");
  const [sprintRemaining, setSprintRemaining] = useState("0");
  const [sprintBurndown, setSprintBurndown] = useState("");

  const [buildStatus, setBuildStatus] = useState("Passing");
  const [buildPipeline, setBuildPipeline] = useState("main");
  const [buildDuration, setBuildDuration] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "overview") {
        setOverview(await api.admin.devManagerOverview(projectId));
      } else if (tab === "instructions") {
        const r = await api.admin.devManagerInstructions(projectId);
        setInstructions(r.instructions);
      } else if (tab === "goals") {
        const r = await api.admin.devManagerGoals(projectId);
        setGoals(r.goals);
      } else if (tab === "tasks") {
        const r = await api.admin.devManagerTasks(projectId);
        setTasks(r.tasks);
      } else if (tab === "reports") {
        const r = await api.admin.devManagerReports(projectId);
        setReports(r.reports);
      } else if (tab === "releases") {
        const r = await api.admin.devManagerReleases(projectId);
        setReleases(r.releases);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to load dev manager data");
    } finally {
      setLoading(false);
    }
  }, [tab, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "instructions", label: "Instructions" },
    { id: "goals", label: "Goals" },
    { id: "tasks", label: "Tasks" },
    { id: "reports", label: "Reports" },
    { id: "releases", label: "Releases" },
    { id: "status", label: "Sprint & Build" },
  ];

  const card = (children: ReactNode) => (
    <div className="rounded-2xl p-4" style={{ background: C.surface, boxShadow: SH1 }}>
      {children}
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-medium flex items-center gap-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            <EngineeringIcon style={{ color: C.primary }} />
            Development Management
          </h1>
          <p className="text-sm mt-1" style={{ color: C.onSurfaceVar }}>
            Chrome extension board — instructions, tasks, daily reports, and internal releases for team devs.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Project ID" value={projectId} onChange={setProjectId} cls="min-w-[140px]" />
          <OutlinedBtn onClick={() => void load()} disabled={loading}>
            <RefreshIcon style={{ fontSize: 18, marginRight: 4 }} />
            Refresh
          </OutlinedBtn>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
            style={{
              background: tab === t.id ? C.primaryContainer : C.surfaceVar,
              color: tab === t.id ? C.onPrimaryContainer : C.onSurfaceVar,
              fontFamily: "Roboto",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && tab !== "status" ? (
        <div className="h-32 rounded-2xl animate-pulse" style={{ background: C.surfaceVar }} />
      ) : tab === "overview" && overview ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Instructions" value={overview.counts.instructions} Icon={EngineeringIcon} color={C.primary} />
          <StatCard label="Goals" value={overview.counts.goals} Icon={EngineeringIcon} color="#006A6A" />
          <StatCard label="Tasks" value={overview.counts.tasks} Icon={EngineeringIcon} color="#386A20" />
          <StatCard label="Daily Reports" value={overview.counts.reports} Icon={EngineeringIcon} color="#7D5260" />
        </div>
      ) : null}

      {tab === "overview" && overview?.latestRelease && (
        <div className="mt-2">{card(
          <p className="text-sm" style={{ color: C.onSurface }}>
            Latest published release: <strong>v{overview.latestRelease.version}</strong>
            {" · "}
            {formatWhen(overview.latestRelease.publishedAt)}
          </p>,
        )}</div>
      )}

      {tab === "instructions" && (
        <div className="space-y-4">
          {card(
            <div className="space-y-3">
              <h2 className="font-medium" style={{ color: C.onSurface }}>New PM instruction</h2>
              <Field label="Title" value={instTitle} onChange={setInstTitle} />
              <Field label="Body" value={instBody} onChange={setInstBody} rows={3} />
              <label className="block text-xs font-medium" style={{ color: C.onSurfaceVar }}>
                Priority
                <select
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm border"
                  style={{ background: C.surface, borderColor: C.outlineVar, color: C.onSurface }}
                  value={instPriority}
                  onChange={(e) => setInstPriority(e.target.value as "normal" | "urgent")}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
              <FilledBtn
                onClick={async () => {
                  if (!instTitle.trim()) return toast.error("Title required");
                  try {
                    await api.admin.createDevManagerInstruction({
                      projectId,
                      title: instTitle.trim(),
                      body: instBody.trim(),
                      priority: instPriority,
                    });
                    setInstTitle("");
                    setInstBody("");
                    toast.success("Instruction created");
                    void load();
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "Create failed");
                  }
                }}
              >
                <AddIcon style={{ fontSize: 18, marginRight: 4 }} />
                Add instruction
              </FilledBtn>
            </div>,
          )}
          <div className="space-y-2">
            {instructions.map((i) => (
              <div key={i.id}>{card(
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" style={{ color: C.onSurface }}>{i.title}</span>
                      <Chip label={i.priority} color={i.priority === "urgent" ? "#B3261E" : undefined} filled={i.priority === "urgent"} />
                    </div>
                    <p className="text-xs mt-1 whitespace-pre-wrap" style={{ color: C.onSurfaceVar }}>{i.body}</p>
                    <p className="text-[11px] mt-2" style={{ color: C.onSurfaceVar }}>
                      From {i.from} · {formatWhen(i.receivedAt)}
                    </p>
                  </div>
                  <OutlinedBtn
                    onClick={() =>
                      onConfirm({
                        title: "Delete instruction?",
                        body: i.title,
                        onOk: async () => {
                          try {
                            await api.admin.deleteDevManagerInstruction(Number(i.id));
                            toast.success("Deleted");
                            void load();
                          } catch (e) {
                            toast.error(e instanceof ApiError ? e.message : "Delete failed");
                          }
                        },
                      })
                    }
                  >
                    <DeleteIcon style={{ fontSize: 18 }} />
                  </OutlinedBtn>
                </div>,
              )}</div>
            ))}
          </div>
        </div>
      )}

      {tab === "goals" && (
        <div className="space-y-4">
          {card(
            <div className="space-y-3">
              <h2 className="font-medium" style={{ color: C.onSurface }}>New goal</h2>
              <Field label="Title" value={goalTitle} onChange={setGoalTitle} />
              <Field label="Description" value={goalDesc} onChange={setGoalDesc} rows={2} />
              <Field label="Progress %" value={goalProgress} onChange={setGoalProgress} />
              <FilledBtn
                onClick={async () => {
                  if (!goalTitle.trim()) return toast.error("Title required");
                  try {
                    await api.admin.createDevManagerGoal({
                      projectId,
                      title: goalTitle.trim(),
                      description: goalDesc.trim(),
                      progress: Number(goalProgress) || 0,
                    });
                    setGoalTitle("");
                    setGoalDesc("");
                    setGoalProgress("0");
                    toast.success("Goal created");
                    void load();
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "Create failed");
                  }
                }}
              >
                Add goal
              </FilledBtn>
            </div>,
          )}
          <div className="space-y-2">
            {goals.map((g) => (
              <div key={g.id}>{card(
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium" style={{ color: C.onSurface }}>{g.title}</div>
                    <p className="text-xs mt-1" style={{ color: C.onSurfaceVar }}>{g.description}</p>
                  </div>
                  <div className="flex items-end gap-2">
                    <Field
                      label="Progress"
                      value={String(g.progress)}
                      onChange={(v) => {
                        setGoals((prev) =>
                          prev.map((x) => (x.id === g.id ? { ...x, progress: Number(v) || 0 } : x)),
                        );
                      }}
                      cls="w-20"
                    />
                    <OutlinedBtn
                      onClick={async () => {
                        const current = goals.find((x) => x.id === g.id);
                        if (!current) return;
                        try {
                          await api.admin.updateDevManagerGoal(Number(g.id), { progress: current.progress });
                          toast.success("Progress saved");
                        } catch (e) {
                          toast.error(e instanceof ApiError ? e.message : "Update failed");
                        }
                      }}
                    >
                      Save
                    </OutlinedBtn>
                  </div>
                </div>,
              )}</div>
            ))}
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <div className="space-y-4">
          {card(
            <div className="space-y-3">
              <h2 className="font-medium" style={{ color: C.onSurface }}>New task</h2>
              <Field label="Title" value={taskTitle} onChange={setTaskTitle} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Assignee" value={taskAssignee} onChange={setTaskAssignee} />
                <Field label="Priority (1–5)" value={taskPriority} onChange={setTaskPriority} />
                <Field label="Milestone" value={taskMilestone} onChange={setTaskMilestone} />
              </div>
              <label className="block text-xs font-medium" style={{ color: C.onSurfaceVar }}>
                Status
                <select
                  className="mt-1 w-full rounded-xl px-3 py-2 text-sm border"
                  style={{ background: C.surface, borderColor: C.outlineVar, color: C.onSurface }}
                  value={taskStatus}
                  onChange={(e) => setTaskStatus(e.target.value)}
                >
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                  ))}
                </select>
              </label>
              <FilledBtn
                onClick={async () => {
                  if (!taskTitle.trim()) return toast.error("Title required");
                  try {
                    await api.admin.createDevManagerTask({
                      projectId,
                      title: taskTitle.trim(),
                      assignee: taskAssignee.trim(),
                      status: taskStatus,
                      priority: Number(taskPriority) || 3,
                      milestone: taskMilestone.trim() || undefined,
                    });
                    setTaskTitle("");
                    toast.success("Task created");
                    void load();
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "Create failed");
                  }
                }}
              >
                Add task
              </FilledBtn>
            </div>,
          )}
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id}>{card(
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium" style={{ color: C.onSurface }}>{t.title}</div>
                    <p className="text-xs mt-1" style={{ color: C.onSurfaceVar }}>
                      {t.assignee || "Unassigned"} · P{t.priority}
                      {t.milestone ? ` · ${t.milestone}` : ""}
                    </p>
                  </div>
                  <select
                    className="rounded-xl px-3 py-2 text-sm border"
                    style={{ background: C.surface, borderColor: C.outlineVar, color: C.onSurface }}
                    value={t.status}
                    onChange={async (e) => {
                      try {
                        await api.admin.updateDevManagerTask(Number(t.id), { status: e.target.value });
                        void load();
                      } catch (err) {
                        toast.error(err instanceof ApiError ? err.message : "Update failed");
                      }
                    }}
                  >
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>{s.replace("_", " ")}</option>
                    ))}
                  </select>
                  <OutlinedBtn
                    onClick={() =>
                      onConfirm({
                        title: "Delete task?",
                        body: t.title,
                        onOk: async () => {
                          try {
                            await api.admin.deleteDevManagerTask(Number(t.id));
                            toast.success("Deleted");
                            void load();
                          } catch (e) {
                            toast.error(e instanceof ApiError ? e.message : "Delete failed");
                          }
                        },
                      })
                    }
                  >
                    <DeleteIcon style={{ fontSize: 18 }} />
                  </OutlinedBtn>
                </div>,
              )}</div>
            ))}
          </div>
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-2">
          {reports.length === 0 ? (
            <p className="text-sm" style={{ color: C.onSurfaceVar }}>No daily reports yet.</p>
          ) : reports.map((r) => (
            <div key={r.id}>{card(
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium" style={{ color: C.onSurface }}>{r.teamMemberName || "Unknown"}</span>
                  <Chip label={r.date} />
                  <Chip label={`${r.hoursWorked}h`} />
                </div>
                <p className="text-sm mt-2" style={{ color: C.onSurface }}>{r.summary}</p>
                {r.completed && (
                  <p className="text-xs mt-2" style={{ color: C.onSurfaceVar }}>
                    <strong>Completed:</strong> {r.completed}
                  </p>
                )}
                {r.blockers && (
                  <p className="text-xs mt-1" style={{ color: C.onSurfaceVar }}>
                    <strong>Blockers:</strong> {r.blockers}
                  </p>
                )}
                {r.nextSteps && (
                  <p className="text-xs mt-1" style={{ color: C.onSurfaceVar }}>
                    <strong>Next:</strong> {r.nextSteps}
                  </p>
                )}
                <p className="text-[11px] mt-2" style={{ color: C.onSurfaceVar }}>
                  Submitted {formatWhen(r.submittedAt)}
                </p>
              </div>,
            )}</div>
          ))}
        </div>
      )}

      {tab === "releases" && (
        <div className="space-y-4">
          {card(
            <div className="space-y-3">
              <h2 className="font-medium" style={{ color: C.onSurface }}>New release</h2>
              <Field label="Version" value={relVersion} onChange={setRelVersion} placeholder="0.3.0-beta.3" />
              <Field label="Download URL" value={relUrl} onChange={setRelUrl} />
              <Field label="Release notes" value={relNotes} onChange={setRelNotes} rows={3} />
              <Field label="SHA-256 checksum (optional)" value={relChecksum} onChange={setRelChecksum} />
              <label className="flex items-center gap-2 text-sm" style={{ color: C.onSurface }}>
                <input type="checkbox" checked={relPublish} onChange={(e) => setRelPublish(e.target.checked)} />
                Publish immediately
              </label>
              <FilledBtn
                onClick={async () => {
                  if (!relVersion.trim()) return toast.error("Version required");
                  try {
                    await api.admin.createDevManagerRelease({
                      projectId,
                      version: relVersion.trim(),
                      downloadUrl: relUrl.trim(),
                      releaseNotes: relNotes.trim(),
                      checksum: relChecksum.trim(),
                      published: relPublish,
                    });
                    setRelVersion("");
                    setRelUrl("");
                    setRelNotes("");
                    setRelChecksum("");
                    toast.success("Release created");
                    void load();
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "Create failed");
                  }
                }}
              >
                Add release
              </FilledBtn>
            </div>,
          )}
          <div className="space-y-2">
            {releases.map((r) => (
              <div key={r.id}>{card(
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: C.onSurface }}>v{r.version}</span>
                      {r.published ? <Chip label="Published" color="#386A20" filled /> : <Chip label="Draft" />}
                    </div>
                    <p className="text-xs mt-1 truncate" style={{ color: C.onSurfaceVar }}>{r.downloadUrl || "No download URL"}</p>
                  </div>
                  {!r.published && (
                    <FilledBtn
                      onClick={async () => {
                        try {
                          await api.admin.updateDevManagerRelease(r.id, { published: true });
                          toast.success("Published");
                          void load();
                        } catch (e) {
                          toast.error(e instanceof ApiError ? e.message : "Publish failed");
                        }
                      }}
                    >
                      Publish
                    </FilledBtn>
                  )}
                </div>,
              )}</div>
            ))}
          </div>
        </div>
      )}

      {tab === "status" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {card(
            <div className="space-y-3">
              <h2 className="font-medium" style={{ color: C.onSurface }}>Current sprint</h2>
              <Field label="Name" value={sprintName} onChange={setSprintName} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Day" value={sprintDay} onChange={setSprintDay} />
                <Field label="Total days" value={sprintTotalDays} onChange={setSprintTotalDays} />
                <Field label="Progress %" value={sprintProgress} onChange={setSprintProgress} />
                <Field label="Remaining points" value={sprintRemaining} onChange={setSprintRemaining} />
              </div>
              <Field label="Burndown (comma-separated)" value={sprintBurndown} onChange={setSprintBurndown} placeholder="40,38,36,33" />
              <FilledBtn
                onClick={async () => {
                  try {
                    await api.admin.updateDevManagerSprint({
                      projectId,
                      name: sprintName.trim() || undefined,
                      day: Number(sprintDay) || undefined,
                      totalDays: Number(sprintTotalDays) || undefined,
                      progress: Number(sprintProgress) || undefined,
                      remainingPoints: Number(sprintRemaining) || undefined,
                      burndown: sprintBurndown
                        ? sprintBurndown.split(",").map((n) => Number(n.trim()) || 0)
                        : undefined,
                    });
                    toast.success("Sprint updated");
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "Update failed");
                  }
                }}
              >
                Save sprint
              </FilledBtn>
            </div>,
          )}
          {card(
            <div className="space-y-3">
              <h2 className="font-medium" style={{ color: C.onSurface }}>Build status</h2>
              <Field label="Status" value={buildStatus} onChange={setBuildStatus} placeholder="Passing" />
              <Field label="Pipeline" value={buildPipeline} onChange={setBuildPipeline} />
              <Field label="Duration" value={buildDuration} onChange={setBuildDuration} placeholder="4m 32s" />
              <FilledBtn
                onClick={async () => {
                  try {
                    await api.admin.updateDevManagerBuildStatus({
                      projectId,
                      status: buildStatus.trim(),
                      pipeline: buildPipeline.trim(),
                      duration: buildDuration.trim(),
                      lastBuild: new Date().toISOString(),
                    });
                    toast.success("Build status updated");
                  } catch (e) {
                    toast.error(e instanceof ApiError ? e.message : "Update failed");
                  }
                }}
              >
                Save build status
              </FilledBtn>
            </div>,
          )}
        </div>
      )}
    </div>
  );
}
