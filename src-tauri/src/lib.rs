use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const DEFAULT_AGENT_BASE_URL: &str = "https://codecli.shop";
const FALLBACK_AGENT_BASE_URL: &str = "http://66.253.42.202:3000/api";
const DEFAULT_CODEX_MODEL: &str = "gpt-5.4";
const CHAT_AGENT_TIMEOUT_SECS: u64 = 120;
const MAX_PROMPT_FILE_CONTENT_CHARS: usize = 6_000;
const MAX_PROMPT_HISTORY_ENTRIES: usize = 6;
const MAX_PROMPT_HISTORY_TOTAL_CHARS: usize = 4_000;

#[cfg(target_os = "windows")]
fn codex_command() -> Command {
  // npm 全局安装在 Windows 上的入口是 codex.cmd；直接调用，避免 `cmd /C` 重新解析参数
  // 把带引号的 `-c base_url="..."` 吞掉，导致 codex 拿不到正确的 base_url 而回落到
  // 用户配置（如 cc-switch 注入的代理），出现连接失败。
  Command::new("codex.cmd")
}

#[cfg(not(target_os = "windows"))]
fn codex_command() -> Command {
  Command::new("codex")
}
const DEFAULT_UPDATER_ENDPOINT: &str =
  "https://github.com/gdfsdjj145/easy-ai/releases/latest/download/latest.json";
const DEFAULT_UPDATER_PUBKEY: &str = include_str!("../keys/updater.key.pub");
const UPDATER_PUBKEY_PLACEHOLDER: &str = "REPLACE_WITH_UPDATER_PUBLIC_KEY";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
  path: String,
  name: String,
  kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
  path: String,
  name: String,
  snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceBinaryPayload {
  data_url: String,
  mime_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledAgent {
  id: String,
  label: String,
  available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableAppUpdate {
  version: String,
  current_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateStatus {
  configured: bool,
  endpoint: String,
  current_version: String,
  update: Option<AvailableAppUpdate>,
  message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateInstallResult {
  installed: bool,
  version: Option<String>,
  message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatContextPayload {
  workspace_path: Option<String>,
  current_file_path: Option<String>,
  current_file_content: Option<String>,
  conversation_history: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentLogEvent {
  request_id: String,
  agent_id: String,
  kind: String,
  text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentRunEvent {
  #[serde(rename = "type")]
  event_type: String,
  task_id: String,
  run_id: String,
  agent_id: Option<String>,
  prompt: Option<String>,
  seq: Option<u64>,
  level: Option<String>,
  text: Option<String>,
  content: Option<String>,
  path: Option<String>,
  reason: Option<String>,
  at: u128,
}

#[tauri::command]
fn validate_workspace(workspace_path: String) -> Result<(), String> {
  let root = canonicalize_root(&workspace_path)?;
  if !root.is_dir() {
    return Err("所选工作区不是有效文件夹。".into());
  }

  Ok(())
}

#[tauri::command]
fn list_workspace(workspace_path: String) -> Result<Vec<WorkspaceEntry>, String> {
  let root = canonicalize_root(&workspace_path)?;
  let mut items = Vec::new();
  visit_directory(&root, &root, &mut items)?;
  items.sort_by(|a, b| a.path.cmp(&b.path));
  Ok(items)
}

#[tauri::command]
fn read_workspace_file(workspace_path: String, relative_path: String) -> Result<String, String> {
  let path = resolve_relative_path(&workspace_path, &relative_path)?;
  fs::read_to_string(path).map_err(|error| format!("读取文件失败：{error}"))
}

#[tauri::command]
fn read_workspace_binary(
  workspace_path: String,
  relative_path: String,
) -> Result<WorkspaceBinaryPayload, String> {
  let path = resolve_relative_path(&workspace_path, &relative_path)?;
  let bytes = fs::read(path).map_err(|error| format!("读取二进制文件失败：{error}"))?;
  let mime_type = mime_type_from_path(&relative_path);
  let encoded = BASE64.encode(bytes);

  Ok(WorkspaceBinaryPayload {
    data_url: format!("data:{mime_type};base64,{encoded}"),
    mime_type: mime_type.to_string(),
  })
}

#[tauri::command]
fn write_workspace_file(
  workspace_path: String,
  relative_path: String,
  content: String,
) -> Result<(), String> {
  let path = resolve_relative_path(&workspace_path, &relative_path)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|error| format!("创建目录失败：{error}"))?;
  }
  fs::write(path, content).map_err(|error| format!("写入文件失败：{error}"))
}

#[tauri::command]
fn create_workspace_directory(workspace_path: String, relative_path: String) -> Result<(), String> {
  let path = resolve_relative_path(&workspace_path, &relative_path)?;
  fs::create_dir_all(path).map_err(|error| format!("创建目录失败：{error}"))
}

#[tauri::command]
fn rename_workspace_path(
  workspace_path: String,
  relative_path: String,
  next_relative_path: String,
) -> Result<(), String> {
  let path = resolve_relative_path(&workspace_path, &relative_path)?;
  let next_path = resolve_relative_path(&workspace_path, &next_relative_path)?;

  if let Some(parent) = next_path.parent() {
    fs::create_dir_all(parent).map_err(|error| format!("创建目标目录失败：{error}"))?;
  }

  fs::rename(path, next_path).map_err(|error| format!("重命名失败：{error}"))
}

#[tauri::command]
fn delete_workspace_path(
  workspace_path: String,
  relative_path: String,
  kind: String,
) -> Result<(), String> {
  let path = resolve_relative_path(&workspace_path, &relative_path)?;

  match kind.as_str() {
    "directory" => fs::remove_dir_all(path).map_err(|error| format!("删除目录失败：{error}")),
    "file" => fs::remove_file(path).map_err(|error| format!("删除文件失败：{error}")),
    _ => Err("不支持的路径类型。".into()),
  }
}

#[tauri::command]
fn search_workspace_files(
  workspace_path: String,
  query: String,
) -> Result<Vec<SearchResult>, String> {
  let root = canonicalize_root(&workspace_path)?;
  let mut matches = Vec::new();
  let lowered = query.to_lowercase();
  visit_search(&root, &root, &lowered, &mut matches)?;
  Ok(matches)
}

#[tauri::command]
fn list_installed_agents() -> Vec<InstalledAgent> {
  vec![
    InstalledAgent {
      id: "claude".into(),
      label: "Claude Code".into(),
      available: command_exists("claude"),
    },
    InstalledAgent {
      id: "codex".into(),
      label: "Codex CLI".into(),
      available: command_exists("codex"),
    },
  ]
}

#[tauri::command]
async fn run_agent_chat(
  app: AppHandle,
  agent_id: String,
  prompt: String,
  api_key: String,
  request_id: String,
  context: ChatContextPayload,
) -> Result<String, String> {
  let final_prompt = build_chat_prompt(&prompt, &context);
  let workspace_path = context.workspace_path.clone();
  let resolved_api_key = resolve_agent_api_key(&agent_id, &api_key)?;

  emit_agent_log(&app, &request_id, &agent_id, "status", "开始调用 agent");

  let app_handle = app.clone();
  let request_id_for_task = request_id.clone();
  let agent_id_for_task = agent_id.clone();
  let agent_id_for_result = agent_id.clone();

  let result = tauri::async_runtime::spawn_blocking(move || match agent_id.as_str() {
    "claude" => run_claude_chat(
      &app_handle,
      &request_id_for_task,
      &agent_id_for_task,
      final_prompt,
      workspace_path.as_deref(),
      &resolved_api_key,
    ),
    "codex" => run_codex_chat(
      &app_handle,
      &request_id_for_task,
      &agent_id_for_task,
      final_prompt,
      workspace_path.as_deref(),
      &resolved_api_key,
    ),
    _ => Err("不支持的 agent。".into()),
  })
  .await
  .map_err(|error| format!("后台调用 agent 失败：{error}"))?;

  match &result {
    Ok(_) => emit_agent_log(&app, &request_id, &agent_id_for_result, "status", "agent 调用完成"),
    Err(error) => emit_agent_log(&app, &request_id, &agent_id_for_result, "error", error),
  }

  result
}

#[tauri::command]
async fn start_agent_run(
  app: AppHandle,
  agent_id: String,
  prompt: String,
  api_key: String,
  run_id: String,
  task_id: String,
  context: ChatContextPayload,
) -> Result<(), String> {
  let final_prompt = build_chat_prompt(&prompt, &context);
  let workspace_path = context.workspace_path.clone();
  let resolved_api_key = resolve_agent_api_key(&agent_id, &api_key)?;

  let app_handle = app.clone();
  let agent_id_for_emit = agent_id.clone();
  tauri::async_runtime::spawn(async move {
    emit_agent_run_event(
      &app_handle,
      AgentRunEvent {
        event_type: "run.started".into(),
        task_id: task_id.clone(),
        run_id: run_id.clone(),
        agent_id: Some(agent_id.clone()),
        prompt: Some(prompt.clone()),
        seq: Some(0),
        level: None,
        text: None,
        content: None,
        path: None,
        reason: None,
        at: current_timestamp_millis(),
      },
    );

    let blocking_app = app_handle.clone();
    let blocking_run_id = run_id.clone();
    let blocking_task_id = task_id.clone();
    let blocking_agent_id = agent_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || match agent_id.as_str() {
      "claude" => run_claude_chat_streamed(
        &blocking_app,
        &blocking_run_id,
        &blocking_task_id,
        &blocking_agent_id,
        final_prompt,
        workspace_path.as_deref(),
        &resolved_api_key,
      ),
      "codex" => run_codex_chat_streamed(
        &blocking_app,
        &blocking_run_id,
        &blocking_task_id,
        &blocking_agent_id,
        final_prompt,
        workspace_path.as_deref(),
        &resolved_api_key,
      ),
      _ => Err("不支持的 agent。".into()),
    })
    .await;

    match result {
      Ok(Ok(reply)) => {
        emit_agent_run_event(
          &app_handle,
          AgentRunEvent {
            event_type: "run.final".into(),
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            agent_id: Some(agent_id_for_emit.clone()),
            prompt: None,
            seq: None,
            level: None,
            text: None,
            content: Some(reply),
            path: None,
            reason: None,
            at: current_timestamp_millis(),
          },
        );
      }
      Ok(Err(error)) => {
        emit_agent_run_event(
          &app_handle,
          AgentRunEvent {
            event_type: "run.error".into(),
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            agent_id: Some(agent_id_for_emit.clone()),
            prompt: None,
            seq: None,
            level: None,
            text: Some(error),
            content: None,
            path: None,
            reason: None,
            at: current_timestamp_millis(),
          },
        );
      }
      Err(error) => {
        emit_agent_run_event(
          &app_handle,
          AgentRunEvent {
            event_type: "run.error".into(),
            task_id: task_id.clone(),
            run_id: run_id.clone(),
            agent_id: Some(agent_id_for_emit.clone()),
            prompt: None,
            seq: None,
            level: None,
            text: Some(format!("后台调用 agent 失败：{error}")),
            content: None,
            path: None,
            reason: None,
            at: current_timestamp_millis(),
          },
        );
      }
    }

    emit_agent_run_event(
      &app_handle,
      AgentRunEvent {
        event_type: "run.done".into(),
        task_id,
        run_id,
        agent_id: Some(agent_id_for_emit),
        prompt: None,
        seq: None,
        level: None,
        text: None,
        content: None,
        path: None,
        reason: None,
        at: current_timestamp_millis(),
      },
    );
  });

  Ok(())
}

#[tauri::command]
async fn install_agent(agent_id: String) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || match agent_id.as_str() {
    "claude" => run_install_command(
      "Claude Code",
      "npm",
      &["install", "-g", "@anthropic-ai/claude-code"],
      Duration::from_secs(300),
    ),
    "codex" => run_install_command(
      "Codex CLI",
      "npm",
      &["install", "-g", "@openai/codex"],
      Duration::from_secs(300),
    ),
    _ => Err("不支持的 agent。".into()),
  })
  .await
  .map_err(|error| format!("安装 agent 失败：{error}"))?
}

#[tauri::command]
async fn test_agent_connection(agent_id: String, api_key: String) -> Result<String, String> {
  let resolved_api_key = resolve_agent_api_key(&agent_id, &api_key)?;

  tauri::async_runtime::spawn_blocking(move || {
    let prompt = "请只回复：连接成功".to_string();
    match agent_id.as_str() {
      "claude" => {
        run_claude_chat_no_log(prompt, None, &resolved_api_key, Duration::from_secs(25))?;
        Ok("Claude Code 连接成功。".into())
      }
      "codex" => {
        run_codex_chat_no_log(prompt, None, &resolved_api_key, Duration::from_secs(25))?;
        Ok("Codex CLI 连接成功。".into())
      }
      _ => Err("不支持的 agent。".into()),
    }
  })
  .await
  .map_err(|error| format!("测试连接失败：{error}"))?
}

#[tauri::command]
async fn check_app_update(app: AppHandle) -> Result<AppUpdateStatus, String> {
  let current_version = app.package_info().version.to_string();
  let endpoint = updater_endpoint().to_string();
  let Some(pubkey) = configured_updater_pubkey() else {
    return Ok(AppUpdateStatus {
      configured: false,
      endpoint,
      current_version,
      update: None,
      message: "未配置 updater 公钥，暂时无法检查桌面应用更新。".into(),
    });
  };

  let update = app
    .updater_builder()
    .pubkey(pubkey)
    .endpoints(vec![parse_updater_endpoint(&endpoint)?])
    .map_err(|error| format!("配置更新源失败：{error}"))?
    .build()
    .map_err(|error| format!("创建更新器失败：{error}"))?
    .check()
    .await
    .map_err(|error| format!("检查更新失败：{error}"))?;

  let message = match &update {
    Some(update) => format!("发现新版本 {}，当前版本 {}。", update.version, update.current_version),
    None => "当前已是最新版本。".into(),
  };

  Ok(AppUpdateStatus {
    configured: true,
    endpoint,
    current_version,
    update: update.map(|update| AvailableAppUpdate {
      version: update.version,
      current_version: update.current_version,
    }),
    message,
  })
}

#[tauri::command]
async fn install_app_update(app: AppHandle) -> Result<AppUpdateInstallResult, String> {
  let endpoint = updater_endpoint().to_string();
  let Some(pubkey) = configured_updater_pubkey() else {
    return Ok(AppUpdateInstallResult {
      installed: false,
      version: None,
      message: "未配置 updater 公钥，暂时无法安装更新。".into(),
    });
  };

  let Some(update) = app
    .updater_builder()
    .pubkey(pubkey)
    .endpoints(vec![parse_updater_endpoint(&endpoint)?])
    .map_err(|error| format!("配置更新源失败：{error}"))?
    .build()
    .map_err(|error| format!("创建更新器失败：{error}"))?
    .check()
    .await
    .map_err(|error| format!("检查更新失败：{error}"))?
  else {
    return Ok(AppUpdateInstallResult {
      installed: false,
      version: None,
      message: "当前没有可安装的更新。".into(),
    });
  };

  let version = update.version.clone();
  update
    .download_and_install(
      |_chunk_length, _content_length| {},
      || {},
    )
    .await
    .map_err(|error| format!("下载并安装更新失败：{error}"))?;

  let app_handle = app.clone();
  thread::spawn(move || {
    thread::sleep(Duration::from_millis(450));
    app_handle.restart();
  });

  Ok(AppUpdateInstallResult {
    installed: true,
    version: Some(version.clone()),
    message: format!("版本 {version} 已安装，应用即将重启。"),
  })
}

fn canonicalize_root(workspace_path: &str) -> Result<PathBuf, String> {
  let root = fs::canonicalize(workspace_path).map_err(|error| format!("无效工作区：{error}"))?;
  if !root.is_dir() {
    return Err("工作区路径必须是一个文件夹。".into());
  }
  Ok(root)
}

fn resolve_relative_path(workspace_path: &str, relative_path: &str) -> Result<PathBuf, String> {
  let root = canonicalize_root(workspace_path)?;
  let relative = Path::new(relative_path);
  if relative.is_absolute() {
    return Err("不允许使用绝对路径。".into());
  }

  if relative.components().any(|component| matches!(component, Component::ParentDir)) {
    return Err("不允许访问工作区外部路径。".into());
  }

  Ok(root.join(relative))
}

fn mime_type_from_path(path: &str) -> &'static str {
  match Path::new(path)
    .extension()
    .and_then(|value| value.to_str())
    .map(|value| value.to_ascii_lowercase())
    .as_deref()
  {
    Some("apng") => "image/apng",
    Some("csv") => "text/csv",
    Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    Some("gif") => "image/gif",
    Some("jpeg") | Some("jpg") => "image/jpeg",
    Some("pdf") => "application/pdf",
    Some("png") => "image/png",
    Some("svg") => "image/svg+xml",
    Some("webp") => "image/webp",
    Some("xls") => "application/vnd.ms-excel",
    Some("xlsx") => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    _ => "application/octet-stream",
  }
}

fn visit_directory(root: &Path, current: &Path, items: &mut Vec<WorkspaceEntry>) -> Result<(), String> {
  let entries = fs::read_dir(current).map_err(|error| format!("读取目录失败：{error}"))?;
  for entry in entries {
    let entry = entry.map_err(|error| format!("读取目录项失败：{error}"))?;
    let path = entry.path();
    let metadata = entry
      .metadata()
      .map_err(|error| format!("读取文件信息失败：{error}"))?;
    let relative = path
      .strip_prefix(root)
      .map_err(|error| format!("计算相对路径失败：{error}"))?
      .to_string_lossy()
      .replace('\\', "/");
    let name = entry.file_name().to_string_lossy().to_string();
    let is_dir = metadata.is_dir();

    items.push(WorkspaceEntry {
      path: relative.clone(),
      name,
      kind: if is_dir { "directory".into() } else { "file".into() },
    });

    if is_dir {
      visit_directory(root, &path, items)?;
    }
  }

  Ok(())
}

fn visit_search(
  root: &Path,
  current: &Path,
  query: &str,
  matches: &mut Vec<SearchResult>,
) -> Result<(), String> {
  let entries = fs::read_dir(current).map_err(|error| format!("读取目录失败：{error}"))?;
  for entry in entries {
    let entry = entry.map_err(|error| format!("读取目录项失败：{error}"))?;
    let path = entry.path();
    let metadata = entry
      .metadata()
      .map_err(|error| format!("读取文件信息失败：{error}"))?;

    if metadata.is_dir() {
      visit_search(root, &path, query, matches)?;
      continue;
    }

    let relative = path
      .strip_prefix(root)
      .map_err(|error| format!("计算相对路径失败：{error}"))?
      .to_string_lossy()
      .replace('\\', "/");
    let name = entry.file_name().to_string_lossy().to_string();
    let name_match = name.to_lowercase().contains(query);
    let content = fs::read_to_string(&path).unwrap_or_default();
    let content_lower = content.to_lowercase();
    let content_match = content_lower.contains(query);

    if !name_match && !content_match {
      continue;
    }

    let snippet = if content_match {
      build_snippet(&content, query)
    } else {
      "命中文件名".into()
    };

    matches.push(SearchResult {
      path: relative,
      name,
      snippet,
    });
  }

  Ok(())
}

fn build_snippet(content: &str, query: &str) -> String {
  let lowered = content.to_lowercase();
  if let Some(index) = lowered.find(query) {
    let mut boundaries = content.char_indices().map(|(idx, _)| idx).collect::<Vec<_>>();
    boundaries.push(content.len());

    let start = previous_boundary(&boundaries, index.saturating_sub(24));
    let end = next_boundary(&boundaries, (index + query.len() + 36).min(content.len()));
    return content[start..end].replace('\n', " ");
  }

  content.chars().take(60).collect()
}

fn emit_agent_log(app: &AppHandle, request_id: &str, agent_id: &str, kind: &str, text: &str) {
  let _ = app.emit(
    "agent-log",
    AgentLogEvent {
      request_id: request_id.to_string(),
      agent_id: agent_id.to_string(),
      kind: kind.to_string(),
      text: text.to_string(),
    },
  );
}

fn current_timestamp_millis() -> u128 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .unwrap_or(0)
}

fn emit_agent_run_event(app: &AppHandle, event: AgentRunEvent) {
  let _ = app.emit("agent-run-event", event);
}

fn emit_agent_run_log(
  app: &AppHandle,
  task_id: &str,
  run_id: &str,
  seq: &AtomicU64,
  level: &str,
  text: &str,
) {
  emit_agent_run_event(
    app,
    AgentRunEvent {
      event_type: "run.log".into(),
      task_id: task_id.to_string(),
      run_id: run_id.to_string(),
      agent_id: None,
      prompt: None,
      seq: Some(seq.fetch_add(1, Ordering::Relaxed) + 1),
      level: Some(level.to_string()),
      text: Some(text.to_string()),
      content: None,
      path: None,
      reason: None,
      at: current_timestamp_millis(),
    },
  );
}

fn resolve_agent_api_key(_agent_id: &str, explicit_api_key: &str) -> Result<String, String> {
  let trimmed = explicit_api_key.trim();
  if !trimmed.is_empty() {
    return Ok(trimmed.to_string());
  }

  Ok(String::new())
}

fn command_exists(command: &str) -> bool {
  #[cfg(target_os = "windows")]
  {
    Command::new("cmd")
      .args(["/C", &format!("where {command} >nul 2>&1")])
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  }

  #[cfg(not(target_os = "windows"))]
  {
    Command::new("sh")
      .arg("-lc")
      .arg(format!("command -v {command} >/dev/null 2>&1"))
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  }
}

fn updater_endpoint() -> &'static str {
  option_env!("EASY_AI_UPDATER_ENDPOINT")
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .unwrap_or(DEFAULT_UPDATER_ENDPOINT)
}

fn parse_updater_endpoint(endpoint: &str) -> Result<url::Url, String> {
  url::Url::parse(endpoint).map_err(|error| format!("更新源地址无效：{error}"))
}

fn configured_updater_pubkey() -> Option<String> {
  let candidate = option_env!("EASY_AI_UPDATER_PUBLIC_KEY")
    .unwrap_or(DEFAULT_UPDATER_PUBKEY)
    .trim();

  if candidate.is_empty() || candidate.contains(UPDATER_PUBKEY_PLACEHOLDER) {
    return None;
  }

  Some(candidate.to_string())
}

fn build_chat_prompt(prompt: &str, context: &ChatContextPayload) -> String {
  let mut blocks = vec![
    "你是一个桌面工作台里的 AI 助手。请直接回答用户问题，默认使用中文，保持简洁。".to_string(),
  ];

  if let Some(workspace_path) = &context.workspace_path {
    blocks.push(format!("当前工作区：{workspace_path}"));
  }

  if let Some(current_file_path) = &context.current_file_path {
    blocks.push(format!("当前文件：{current_file_path}"));
  }

  if let Some(current_file_content) = &context.current_file_content {
    if !current_file_content.trim().is_empty() {
      let compacted_content = truncate_for_prompt(current_file_content, MAX_PROMPT_FILE_CONTENT_CHARS);
      blocks.push(format!(
        "当前文件内容如下：\n```text\n{compacted_content}\n```"
      ));
    }
  }

  if !context.conversation_history.is_empty() {
    let compacted_history = compact_conversation_history(&context.conversation_history);
    blocks.push(format!(
      "最近对话：\n{}",
      compacted_history
    ));
  }

  blocks.push(format!("用户问题：{prompt}"));
  blocks.join("\n\n")
}

fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
  let total_chars = text.chars().count();
  if total_chars <= max_chars {
    return text.to_string();
  }

  let preview: String = text.chars().take(max_chars).collect();
  format!("{preview}\n\n[内容已截断，共 {total_chars} 个字符。若需要完整内容，请结合当前文件路径继续读取。]")
}

fn compact_conversation_history(history: &[String]) -> String {
  let start_index = history.len().saturating_sub(MAX_PROMPT_HISTORY_ENTRIES);
  let mut selected: Vec<String> = history[start_index..].to_vec();
  let mut joined = selected.join("\n");

  while joined.chars().count() > MAX_PROMPT_HISTORY_TOTAL_CHARS && selected.len() > 1 {
    selected.remove(0);
    joined = selected.join("\n");
  }

  if joined.chars().count() > MAX_PROMPT_HISTORY_TOTAL_CHARS {
    joined = truncate_for_prompt(&joined, MAX_PROMPT_HISTORY_TOTAL_CHARS);
  }

  if start_index > 0 {
    format!("[仅保留最近 {} 条对话]\n{joined}", selected.len())
  } else {
    joined
  }
}

fn agent_base_urls() -> [&'static str; 2] {
  [DEFAULT_AGENT_BASE_URL, FALLBACK_AGENT_BASE_URL]
}

fn should_retry_with_fallback(error: &str) -> bool {
  let normalized = error.to_lowercase();
  [
    "stream disconnected before completion",
    "error sending request for url",
    "reconnecting",
    "retrying",
    "connection reset",
    "connection refused",
    "connection aborted",
    "timed out",
    "timeout",
    "dns",
    "tls",
    "handshake",
    "broken pipe",
    "unexpected eof",
    "network",
    "bad gateway",
    "gateway",
    "502",
    "503",
    "504",
  ]
  .iter()
  .any(|pattern| normalized.contains(pattern))
}

fn should_treat_stderr_as_status(text: &str) -> bool {
  let normalized = text.to_lowercase();
  normalized.contains("reconnecting") || normalized.contains("retrying")
}

fn normalize_status_log_text(text: &str) -> String {
  let trimmed = text.trim();
  if let Some(rest) = trimmed.strip_prefix("ERROR: ") {
    rest.trim().to_string()
  } else if let Some(rest) = trimmed.strip_prefix("WARN: ") {
    rest.trim().to_string()
  } else {
    trimmed.to_string()
  }
}

fn run_claude_chat(
  app: &AppHandle,
  request_id: &str,
  agent_id: &str,
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
) -> Result<String, String> {
  run_claude_chat_with_timeout(
    app,
    request_id,
    agent_id,
    prompt,
    workspace_path,
    api_key,
    Duration::from_secs(CHAT_AGENT_TIMEOUT_SECS),
  )
}

fn run_claude_chat_streamed(
  app: &AppHandle,
  run_id: &str,
  task_id: &str,
  agent_id: &str,
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
) -> Result<String, String> {
  emit_agent_log(app, run_id, agent_id, "status", "开始调用 agent");
  run_claude_chat_with_timeout_using_base_url_streamed(
    app,
    run_id,
    task_id,
    agent_id,
    &prompt,
    workspace_path,
    api_key,
    Duration::from_secs(CHAT_AGENT_TIMEOUT_SECS),
    DEFAULT_AGENT_BASE_URL,
  )
}

fn run_claude_chat_no_log(
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
) -> Result<String, String> {
  for (index, base_url) in agent_base_urls().iter().enumerate() {
    match run_claude_chat_no_log_with_base_url(&prompt, workspace_path, api_key, timeout, base_url) {
      Ok(reply) => return Ok(reply),
      Err(error) if index == 0 && should_retry_with_fallback(&error) => continue,
      Err(error) => return Err(error),
    }
  }

  Err("Claude Code 调用失败。".into())
}

fn run_claude_chat_no_log_with_base_url(
  prompt: &str,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
  base_url: &str,
) -> Result<String, String> {
  let mut command = Command::new("claude");
  command
    .arg("-p")
    .arg("--output-format")
    .arg("text")
    .arg("--tools")
    .arg("");

  if !api_key.trim().is_empty() {
    command
      .env("ANTHROPIC_BASE_URL", base_url)
      .env("ANTHROPIC_API_KEY", api_key)
      .env("ANTHROPIC_AUTH_TOKEN", api_key);
  }

  if let Some(workspace_path) = workspace_path {
    command.arg("--add-dir").arg(workspace_path);
  }

  let output = run_command_with_timeout_silent(command, timeout, "Claude Code", Some(prompt.as_bytes()))?;
  finalize_command_output(output, "Claude Code")
}

fn run_claude_chat_with_timeout(
  app: &AppHandle,
  request_id: &str,
  agent_id: &str,
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
) -> Result<String, String> {
  emit_agent_log(app, request_id, agent_id, "status", "启动 Claude Code");
  for (index, base_url) in agent_base_urls().iter().enumerate() {
    match run_claude_chat_with_timeout_using_base_url(
      app,
      request_id,
      agent_id,
      &prompt,
      workspace_path,
      api_key,
      timeout,
      base_url,
    ) {
      Ok(reply) => return Ok(reply),
      Err(error) if index == 0 && should_retry_with_fallback(&error) => {
        emit_agent_log(
          app,
          request_id,
          agent_id,
          "status",
          &format!("主地址请求失败，尝试降级到 {FALLBACK_AGENT_BASE_URL}"),
        );
      }
      Err(error) => return Err(error),
    }
  }

  Err("Claude Code 调用失败。".into())
}

fn run_claude_chat_with_timeout_using_base_url(
  app: &AppHandle,
  request_id: &str,
  agent_id: &str,
  prompt: &str,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
  base_url: &str,
) -> Result<String, String> {
  let mut command = Command::new("claude");
  command
    .arg("-p")
    .arg("--output-format")
    .arg("text")
    .arg("--tools")
    .arg("");

  if !api_key.trim().is_empty() {
    command
      .env("ANTHROPIC_BASE_URL", base_url)
      .env("ANTHROPIC_API_KEY", api_key)
      .env("ANTHROPIC_AUTH_TOKEN", api_key);
  }

  if let Some(workspace_path) = workspace_path {
    command.arg("--add-dir").arg(workspace_path);
  }

  let output = run_command_with_timeout(
    app,
    request_id,
    None,
    agent_id,
    command,
    timeout,
    "Claude Code",
    Some(prompt.as_bytes()),
    false,
  )?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Claude Code 调用失败。".into()
    } else {
      stderr
    });
  }

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if stdout.is_empty() {
    return Err("Claude Code 没有返回内容。".into());
  }

  Ok(stdout)
}

fn run_claude_chat_with_timeout_using_base_url_streamed(
  app: &AppHandle,
  run_id: &str,
  task_id: &str,
  agent_id: &str,
  prompt: &str,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
  base_url: &str,
) -> Result<String, String> {
  let mut command = Command::new("claude");
  command
    .arg("-p")
    .arg("--output-format")
    .arg("text")
    .arg("--tools")
    .arg("");

  if !api_key.trim().is_empty() {
    command
      .env("ANTHROPIC_BASE_URL", base_url)
      .env("ANTHROPIC_API_KEY", api_key)
      .env("ANTHROPIC_AUTH_TOKEN", api_key);
  }

  if let Some(workspace_path) = workspace_path {
    command.arg("--add-dir").arg(workspace_path);
  }

  let output = run_command_with_timeout(
    app,
    run_id,
    Some(task_id),
    agent_id,
    command,
    timeout,
    "Claude Code",
    Some(prompt.as_bytes()),
    false,
  )?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Claude Code 调用失败。".into()
    } else {
      stderr
    });
  }

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if stdout.is_empty() {
    return Err("Claude Code 没有返回内容。".into());
  }

  Ok(stdout)
}

fn run_codex_chat(
  app: &AppHandle,
  request_id: &str,
  agent_id: &str,
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
) -> Result<String, String> {
  run_codex_chat_with_timeout(
    app,
    request_id,
    agent_id,
    prompt,
    workspace_path,
    api_key,
    Duration::from_secs(CHAT_AGENT_TIMEOUT_SECS),
  )
}

fn run_codex_chat_streamed(
  app: &AppHandle,
  run_id: &str,
  task_id: &str,
  agent_id: &str,
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
) -> Result<String, String> {
  emit_agent_log(app, run_id, agent_id, "status", "开始调用 agent");
  run_codex_chat_with_timeout_using_base_url_streamed(
    app,
    run_id,
    task_id,
    agent_id,
    &prompt,
    workspace_path,
    api_key,
    Duration::from_secs(CHAT_AGENT_TIMEOUT_SECS),
    DEFAULT_AGENT_BASE_URL,
  )
}

fn run_codex_chat_no_log(
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
) -> Result<String, String> {
  for (index, base_url) in agent_base_urls().iter().enumerate() {
    match run_codex_chat_no_log_with_base_url(&prompt, workspace_path, api_key, timeout, base_url) {
      Ok(reply) => return Ok(reply),
      Err(error) if index == 0 && should_retry_with_fallback(&error) => continue,
      Err(error) => return Err(error),
    }
  }

  Err("Codex CLI 调用失败。".into())
}

fn run_codex_chat_no_log_with_base_url(
  prompt: &str,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
  base_url: &str,
) -> Result<String, String> {
  let temp_name = format!(
    "easy-ai-codex-{}.txt",
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0)
  );
  let output_path = std::env::temp_dir().join(temp_name);

  let mut command = codex_command();
  command
    .arg("exec")
    .arg("--skip-git-repo-check")
    .arg("--color")
    .arg("never")
    .arg("--model")
    .arg(DEFAULT_CODEX_MODEL)
    .arg("-c")
    .arg(format!("base_url=\"{}\"", base_url))
    .arg("-c")
    .arg(format!("openai_base_url=\"{}\"", base_url))
    .arg("-o")
    .arg(&output_path)
    .arg("-");

  if !api_key.trim().is_empty() {
    command.env("OPENAI_API_KEY", api_key);
  }

  if let Some(workspace_path) = workspace_path {
    command.arg("-C").arg(workspace_path);
  }

  let output = run_command_with_timeout_silent(command, timeout, "Codex CLI", Some(prompt.as_bytes()))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Codex CLI 调用失败。".into()
    } else {
      stderr
    });
  }

  let reply = fs::read_to_string(&output_path)
    .map_err(|error| format!("读取 Codex 输出失败：{error}"))?
    .trim()
    .to_string();
  let _ = fs::remove_file(&output_path);

  if reply.is_empty() {
    return Err("Codex CLI 没有返回内容。".into());
  }

  Ok(reply)
}

fn run_codex_chat_with_timeout(
  app: &AppHandle,
  request_id: &str,
  agent_id: &str,
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
) -> Result<String, String> {
  emit_agent_log(app, request_id, agent_id, "status", "启动 Codex CLI");
  for (index, base_url) in agent_base_urls().iter().enumerate() {
    match run_codex_chat_with_timeout_using_base_url(
      app,
      request_id,
      agent_id,
      &prompt,
      workspace_path,
      api_key,
      timeout,
      base_url,
    ) {
      Ok(reply) => return Ok(reply),
      Err(error) if index == 0 && should_retry_with_fallback(&error) => {
        emit_agent_log(
          app,
          request_id,
          agent_id,
          "status",
          &format!("主地址请求失败，尝试降级到 {FALLBACK_AGENT_BASE_URL}"),
        );
      }
      Err(error) => return Err(error),
    }
  }

  Err("Codex CLI 调用失败。".into())
}

fn run_codex_chat_with_timeout_using_base_url(
  app: &AppHandle,
  request_id: &str,
  agent_id: &str,
  prompt: &str,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
  base_url: &str,
) -> Result<String, String> {
  let temp_name = format!(
    "easy-ai-codex-{}.txt",
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0)
  );
  let output_path = std::env::temp_dir().join(temp_name);

  let mut command = codex_command();
  command
    .arg("exec")
    .arg("--skip-git-repo-check")
    .arg("--color")
    .arg("never")
    .arg("--model")
    .arg(DEFAULT_CODEX_MODEL)
    .arg("-c")
    .arg(format!("base_url=\"{}\"", base_url))
    .arg("-c")
    .arg(format!("openai_base_url=\"{}\"", base_url))
    .arg("-o")
    .arg(&output_path)
    .arg("-");

  if !api_key.trim().is_empty() {
    command.env("OPENAI_API_KEY", api_key);
  }

  if let Some(workspace_path) = workspace_path {
    command.arg("-C").arg(workspace_path);
  }

  let output = run_command_with_timeout(
    app,
    request_id,
    None,
    agent_id,
    command,
    timeout,
    "Codex CLI",
    Some(prompt.as_bytes()),
    true,
  )?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Codex CLI 调用失败。".into()
    } else {
      stderr
    });
  }

  let reply = fs::read_to_string(&output_path)
    .map_err(|error| format!("读取 Codex 输出失败：{error}"))?
    .trim()
    .to_string();
  let _ = fs::remove_file(&output_path);

  if reply.is_empty() {
    return Err("Codex CLI 没有返回内容。".into());
  }

  Ok(reply)
}

fn run_codex_chat_with_timeout_using_base_url_streamed(
  app: &AppHandle,
  run_id: &str,
  task_id: &str,
  agent_id: &str,
  prompt: &str,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
  base_url: &str,
) -> Result<String, String> {
  let temp_name = format!(
    "easy-ai-codex-{}.txt",
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0)
  );
  let output_path = std::env::temp_dir().join(temp_name);

  let mut command = codex_command();
  command
    .arg("exec")
    .arg("--skip-git-repo-check")
    .arg("--color")
    .arg("never")
    .arg("--model")
    .arg(DEFAULT_CODEX_MODEL)
    .arg("-c")
    .arg(format!("base_url=\"{}\"", base_url))
    .arg("-c")
    .arg(format!("openai_base_url=\"{}\"", base_url))
    .arg("-o")
    .arg(&output_path)
    .arg("-");

  if !api_key.trim().is_empty() {
    command.env("OPENAI_API_KEY", api_key);
  }

  if let Some(workspace_path) = workspace_path {
    command.arg("-C").arg(workspace_path);
  }

  let output = run_command_with_timeout(
    app,
    run_id,
    Some(task_id),
    agent_id,
    command,
    timeout,
    "Codex CLI",
    Some(prompt.as_bytes()),
    true,
  )?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      "Codex CLI 调用失败。".into()
    } else {
      stderr
    });
  }

  let reply = fs::read_to_string(&output_path)
    .map_err(|error| format!("读取 Codex 输出失败：{error}"))?
    .trim()
    .to_string();
  let _ = fs::remove_file(&output_path);

  if reply.is_empty() {
    return Err("Codex CLI 没有返回内容。".into());
  }

  Ok(reply)
}

fn run_install_command(
  label: &str,
  program: &str,
  args: &[&str],
  timeout: Duration,
) -> Result<String, String> {
  if !command_exists(program) {
    return Err(format!("未检测到 {program}，请先安装 Node.js / npm。"));
  }

  let mut command = Command::new(program);
  command.args(args);
  let output = run_command_with_timeout_silent(command, timeout, label, None)?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      format!("{label} 安装失败。")
    } else {
      stderr
    });
  }

  Ok(format!("{label} 安装完成。"))
}

fn run_command_with_timeout_silent(
  mut command: Command,
  timeout: Duration,
  label: &str,
  stdin_input: Option<&[u8]>,
) -> Result<std::process::Output, String> {
  let mut child = command
    .stdin(if stdin_input.is_some() { Stdio::piped() } else { Stdio::null() })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("启动 {label} 失败：{error}"))?;

  if let Some(input) = stdin_input {
    if let Some(mut stdin_pipe) = child.stdin.take() {
      stdin_pipe
        .write_all(input)
        .map_err(|error| format!("写入 {label} 输入失败：{error}"))?;
    }
  }

  let output = child
    .wait_with_output()
    .map_err(|error| format!("{label} 运行失败：{error}"))?;

  if timeout.is_zero() {
    return Ok(output);
  }

  Ok(output)
}

fn finalize_command_output(output: std::process::Output, label: &str) -> Result<String, String> {
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    return Err(if stderr.is_empty() {
      format!("{label} 调用失败。")
    } else {
      stderr
    });
  }

  let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
  if stdout.is_empty() {
    return Err(format!("{label} 没有返回内容。"));
  }

  Ok(stdout)
}

fn run_command_with_timeout(
  app: &AppHandle,
  request_id: &str,
  task_id: Option<&str>,
  agent_id: &str,
  mut command: Command,
  timeout: Duration,
  label: &str,
  stdin_input: Option<&[u8]>,
  stream_stdout_logs: bool,
) -> Result<std::process::Output, String> {
  let mut child = command
    .stdin(if stdin_input.is_some() { Stdio::piped() } else { Stdio::null() })
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("启动 {label} 失败：{error}"))?;

  if let Some(input) = stdin_input {
    if let Some(mut stdin_pipe) = child.stdin.take() {
      stdin_pipe
        .write_all(input)
        .map_err(|error| format!("写入 {label} 输入失败：{error}"))?;
    }
  }

  let stdout_buffer = Arc::new(Mutex::new(Vec::new()));
  let stderr_buffer = Arc::new(Mutex::new(Vec::new()));
  let last_activity = Arc::new(Mutex::new(Instant::now()));
  let task_id = task_id.map(|value| value.to_string());
  let seq = Arc::new(AtomicU64::new(0));

  let stdout_thread = child.stdout.take().map(|stdout_pipe| {
    let app = app.clone();
    let request_id = request_id.to_string();
    let agent_id = agent_id.to_string();
    let task_id = task_id.clone();
    let seq = Arc::clone(&seq);
    let stdout_buffer = Arc::clone(&stdout_buffer);
    let last_activity = Arc::clone(&last_activity);

    thread::spawn(move || {
      let mut reader = BufReader::new(stdout_pipe);
      let mut line = String::new();

      loop {
        line.clear();
        let read = reader.read_line(&mut line).unwrap_or(0);
        if read == 0 {
          break;
        }

        if let Ok(mut buffer) = stdout_buffer.lock() {
          buffer.extend_from_slice(line.as_bytes());
        }
        if let Ok(mut activity) = last_activity.lock() {
          *activity = Instant::now();
        }

        if stream_stdout_logs {
          emit_agent_log(&app, &request_id, &agent_id, "stdout", line.trim_end());
        }
        if let Some(task_id) = &task_id {
          emit_agent_run_log(&app, task_id, &request_id, &seq, "stdout", line.trim_end());
        }
      }
    })
  });

  let stderr_thread = child.stderr.take().map(|stderr_pipe| {
    let app = app.clone();
    let request_id = request_id.to_string();
    let agent_id = agent_id.to_string();
    let task_id = task_id.clone();
    let seq = Arc::clone(&seq);
    let stderr_buffer = Arc::clone(&stderr_buffer);
    let last_activity = Arc::clone(&last_activity);

    thread::spawn(move || {
      let mut reader = BufReader::new(stderr_pipe);
      let mut line = String::new();

      loop {
        line.clear();
        let read = reader.read_line(&mut line).unwrap_or(0);
        if read == 0 {
          break;
        }

        if let Ok(mut buffer) = stderr_buffer.lock() {
          buffer.extend_from_slice(line.as_bytes());
        }
        if let Ok(mut activity) = last_activity.lock() {
          *activity = Instant::now();
        }

        let trimmed = line.trim_end();
        let kind = if should_treat_stderr_as_status(trimmed) {
          "status"
        } else {
          "stderr"
        };
        let text = if kind == "status" {
          normalize_status_log_text(trimmed)
        } else {
          trimmed.to_string()
        };
        emit_agent_log(&app, &request_id, &agent_id, kind, &text);
        if let Some(task_id) = &task_id {
          emit_agent_run_log(&app, task_id, &request_id, &seq, kind, &text);
        }
      }
    })
  });

  loop {
    if let Some(status) = child.try_wait().map_err(|error| format!("{label} 状态检查失败：{error}"))? {
      if let Some(handle) = stdout_thread {
        let _ = handle.join();
      }
      if let Some(handle) = stderr_thread {
        let _ = handle.join();
      }

      let stdout = stdout_buffer.lock().map(|buffer| buffer.clone()).unwrap_or_default();
      let stderr = stderr_buffer.lock().map(|buffer| buffer.clone()).unwrap_or_default();

      return Ok(std::process::Output { status, stdout, stderr });
    }

    let elapsed = last_activity.lock().map(|activity| activity.elapsed()).unwrap_or_default();
    if elapsed >= timeout {
      let _ = child.kill();
      let _ = child.wait();
      return Err(format!("{label} 调用空闲超时，请检查网络状态或本机 CLI 是否可正常独立运行。"));
    }

    thread::sleep(Duration::from_millis(100));
  }
}

fn previous_boundary(boundaries: &[usize], index: usize) -> usize {
  boundaries
    .iter()
    .copied()
    .take_while(|boundary| *boundary <= index)
    .last()
    .unwrap_or(0)
}

fn next_boundary(boundaries: &[usize], index: usize) -> usize {
  boundaries
    .iter()
    .copied()
    .find(|boundary| *boundary >= index)
    .unwrap_or_else(|| *boundaries.last().unwrap_or(&index))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      validate_workspace,
      list_workspace,
      read_workspace_file,
      read_workspace_binary,
      write_workspace_file,
      create_workspace_directory,
      rename_workspace_path,
      delete_workspace_path,
      search_workspace_files,
      list_installed_agents,
      start_agent_run,
      run_agent_chat,
      install_agent,
      test_agent_connection,
      check_app_update,
      install_app_update
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
