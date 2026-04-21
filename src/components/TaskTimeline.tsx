import { useMemo, useState } from "react";
import { Bot, ChevronDown, CircleDot, Terminal, User } from "lucide-react";
import { cn, formatRelativeTime } from "../lib/utils";
import type { AgentRun, PendingWrite, RunEvent, TaskThread, TimelineMessage } from "../types";

interface TaskTimelineProps {
  task: TaskThread | null;
  runs: AgentRun[];
  messages: TimelineMessage[];
  runEvents: RunEvent[];
  pendingWrite: PendingWrite | null;
  onConfirmWrite: () => void;
  onCancelWrite: () => void;
}

interface RunBundle {
  run: AgentRun;
  promptMessage: TimelineMessage | null;
  finalMessages: TimelineMessage[];
  errorMessages: TimelineMessage[];
  logEvents: RunEvent[];
  pendingWriteEvent: RunEvent | null;
}

export function TaskTimeline({
  task,
  runs,
  messages,
  runEvents,
  pendingWrite,
  onConfirmWrite,
  onCancelWrite,
}: TaskTimelineProps) {
  const bundles = useMemo<RunBundle[]>(() => {
    return [...runs]
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .map((run) => {
        const runMessages = messages.filter((message) => message.runId === run.id);
        const runMessageOrder = [...runMessages].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        const orderedEvents = runEvents
          .filter((event) => event.runId === run.id)
          .sort((a, b) => a.seq - b.seq || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        return {
          run,
          promptMessage: runMessageOrder.find((message) => message.kind === "prompt") ?? null,
          finalMessages: runMessageOrder.filter((message) => message.kind === "final"),
          errorMessages: runMessageOrder.filter((message) => message.kind === "error"),
          logEvents: orderedEvents.filter((event) => event.type === "status" || event.type === "stdout" || event.type === "stderr"),
          pendingWriteEvent: [...orderedEvents].reverse().find((event) => event.type === "pending_write") ?? null,
        };
      });
  }, [messages, runEvents, runs]);
  const standaloneMessages = useMemo(
    () =>
      messages
        .filter((message) => !message.runId && (message.kind === "info" || message.kind === "error" || message.kind === "final"))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  if (!task || (bundles.length === 0 && standaloneMessages.length === 0)) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[24px] border border-dashed border-[#e2ddd5] bg-white/70 px-6 text-center">
        <Bot className="h-10 w-10 text-[#d3a31f]" />
        <p className="mt-5 text-[32px] font-semibold tracking-[-0.03em] text-[#2a2a29]">
          从这里开始对话
        </p>
        <p className="mt-3 max-w-lg text-[15px] leading-7 text-[#8b857e]">
          输入提示开始对话；点击左栏文件可在右侧查看内容。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {bundles.map((bundle) => (
        <section key={bundle.run.id} className="space-y-4">
          {bundle.promptMessage ? <UserPromptCard message={bundle.promptMessage} /> : null}
          <ExecutionGroupCard run={bundle.run} events={bundle.logEvents} />
          {bundle.pendingWriteEvent ? (
            <PendingWriteCard
              event={bundle.pendingWriteEvent}
              pendingWrite={pendingWrite}
              onConfirmWrite={onConfirmWrite}
              onCancelWrite={onCancelWrite}
            />
          ) : null}
          {bundle.finalMessages.map((message) => (
            <AssistantFinalCard key={message.id} message={message} />
          ))}
          {bundle.errorMessages.map((message) => (
            <SystemErrorCard key={message.id} message={message} />
          ))}
        </section>
      ))}
      {standaloneMessages.map((message) =>
        message.kind === "error" ? (
          <SystemErrorCard key={message.id} message={message} />
        ) : (
          <InfoCard key={message.id} message={message} />
        ),
      )}
    </div>
  );
}

function UserPromptCard({ message }: { message: TimelineMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[82%] rounded-[20px] bg-[#f3eee7] px-5 py-4 text-[#4c4944] shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
        <div className="flex items-center justify-end gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9b9388]">
          <span>{formatRelativeTime(message.createdAt)}</span>
          <User className="h-3.5 w-3.5" />
        </div>
        <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7">{message.content}</p>
      </div>
    </div>
  );
}

function AssistantFinalCard({ message }: { message: TimelineMessage }) {
  return (
    <div className="px-1 text-[#383736]">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9388]">
          AI
        </span>
        <span className="h-px flex-1 bg-[#ede7de]" />
      </div>
      <div className="mt-2.5 whitespace-pre-wrap rounded-[18px] border border-[#ece6dc] bg-white/88 px-4 py-3 text-[14px] leading-7">
        {message.content}
      </div>
    </div>
  );
}

function SystemErrorCard({ message }: { message: TimelineMessage }) {
  return (
    <div className="rounded-[18px] border border-[#f0d7d0] bg-[#fbefea] px-4 py-3 text-[14px] leading-7 text-[#8c5140]">
      {message.content}
    </div>
  );
}

function InfoCard({ message }: { message: TimelineMessage }) {
  return (
    <div className="rounded-[18px] border border-[#ece6dc] bg-white px-4 py-3 text-[14px] leading-7 text-[#6b655e]">
      {message.content}
    </div>
  );
}

function ExecutionGroupCard({
  run,
  events,
}: {
  run: AgentRun;
  events: RunEvent[];
}) {
  const [open, setOpen] = useState(run.status === "running");
  const statusLabel = run.status === "running" ? "运行中" : run.status === "done" ? "已完成" : run.status === "cancelled" ? "已取消" : "异常";
  const statusTone =
    run.status === "running"
      ? "text-[#9f7a16] bg-[#fbf2d5]"
      : run.status === "done"
        ? "text-[#56744f] bg-[#e7f0e3]"
        : "text-[#9a5b4d] bg-[#f7e6e2]";
  const agentLabel = run.agentId === "claude" ? "Claude Code" : run.agentId === "codex" ? "Codex CLI" : "Local Agent";

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#ece6dc] bg-[#fbfaf7]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[#f5f0e6]"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-[#8f8a83]" />
            <span className="truncate text-[13px] font-semibold uppercase tracking-[0.16em] text-[#6e695f]">
              {agentLabel}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-[#8c867d]">
            {events.length > 0 ? `执行过程 ${events.length} 条记录` : "等待 CLI 输出…"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]", statusTone)}>
            {statusLabel}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-[#8f8a83] transition", !open && "-rotate-90")} />
        </div>
      </button>
      {open ? (
        <div className="border-t border-[#efe8dd] px-4 py-3">
          <div className="space-y-2">
            {events.length > 0 ? (
              events.map((event) => (
                <RunEventLine key={event.id} event={event} />
              ))
            ) : (
              <div className="text-[12px] leading-6 text-[#948f87]">等待 CLI 响应…</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RunEventLine({ event }: { event: RunEvent }) {
  const badgeTone =
    event.type === "status"
      ? "bg-[#f1ebe2] text-[#9a948b]"
      : event.type === "stdout"
        ? "bg-[#e8efe6] text-[#6d8b68]"
        : "bg-[#f4e7e3] text-[#b16e5b]";
  const badgeLabel = event.type === "status" ? "状态" : event.type === "stdout" ? "输出" : "日志";

  return (
    <div className="text-[12px] leading-5.5 text-[#7c756d]">
      <span className={cn("mr-2 inline-block rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em]", badgeTone)}>
        {badgeLabel}
      </span>
      <span className="whitespace-pre-wrap">{event.text}</span>
    </div>
  );
}

function PendingWriteCard({
  event,
  pendingWrite,
  onConfirmWrite,
  onCancelWrite,
}: {
  event: RunEvent;
  pendingWrite: PendingWrite | null;
  onConfirmWrite: () => void;
  onCancelWrite: () => void;
}) {
  const isActivePendingWrite =
    !!pendingWrite &&
    pendingWrite.path === event.path &&
    pendingWrite.reason === event.reason &&
    pendingWrite.content === event.content;

  return (
    <div className="rounded-[20px] border border-[#ebe2d7] bg-white px-4 py-4 shadow-[0_4px_12px_rgba(0,0,0,0.03)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9b9388]">
        <CircleDot className="h-3.5 w-3.5" />
        <span>待确认写入</span>
      </div>
      <p className="mt-3 text-sm font-medium text-[#2f2d29]">{event.path}</p>
      {event.reason ? <p className="mt-1 text-sm leading-6 text-[#7d776f]">{event.reason}</p> : null}
      {isActivePendingWrite ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onConfirmWrite}
            className="rounded-full bg-[#151515] px-4 py-2 text-sm font-semibold text-white"
          >
            确认写入
          </button>
          <button
            type="button"
            onClick={onCancelWrite}
            className="rounded-full border border-[#ddd7ce] bg-white px-4 py-2 text-sm font-semibold text-[#44423f]"
          >
            取消
          </button>
        </div>
      ) : null}
    </div>
  );
}
