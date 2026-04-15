use rusqlite::{params, Connection, OptionalExtension};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const DEFAULT_AGENT_BASE_URL: &str = "https://codecli.shop";
const DEFAULT_CODEX_MODEL: &str = "gpt-5.4";
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcSwitchSettings {
  current_provider_claude: Option<String>,
  current_provider_codex: Option<String>,
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

fn resolve_agent_api_key(agent_id: &str, explicit_api_key: &str) -> Result<String, String> {
  let trimmed = explicit_api_key.trim();
  if !trimmed.is_empty() {
    return Ok(trimmed.to_string());
  }

  if let Some(local_key) = read_cc_switch_api_key(agent_id)? {
    return Ok(local_key);
  }

  Err("请先在设置页填写 API Key，或确保本机 cc-switch 已配置当前 provider。".into())
}

fn read_cc_switch_api_key(agent_id: &str) -> Result<Option<String>, String> {
  let home_dir = resolve_home_dir()?;
  let settings_path = home_dir.join(".cc-switch/settings.json");
  let db_path = home_dir.join(".cc-switch/cc-switch.db");

  if !settings_path.exists() || !db_path.exists() {
    return Ok(None);
  }

  let settings_raw = fs::read_to_string(&settings_path)
    .map_err(|error| format!("读取 cc-switch settings 失败：{error}"))?;
  let settings: CcSwitchSettings = serde_json::from_str(&settings_raw)
    .map_err(|error| format!("解析 cc-switch settings 失败：{error}"))?;

  let provider_id = match agent_id {
    "claude" => settings.current_provider_claude,
    "codex" => settings.current_provider_codex,
    _ => None,
  };

  let Some(provider_id) = provider_id else {
    return Ok(None);
  };

  let connection = Connection::open(db_path)
    .map_err(|error| format!("打开 cc-switch 数据库失败：{error}"))?;

  let mut statement = connection
    .prepare("SELECT settings_config FROM providers WHERE id = ?1 AND app_type = ?2 LIMIT 1")
    .map_err(|error| format!("查询 cc-switch provider 失败：{error}"))?;

  let settings_config: Option<String> = statement
    .query_row(params![provider_id, agent_id], |row| row.get(0))
    .optional()
    .map_err(|error| format!("读取 cc-switch provider 配置失败：{error}"))?;

  let Some(settings_config) = settings_config else {
    return Ok(None);
  };

  let config_value: Value = serde_json::from_str(&settings_config)
    .map_err(|error| format!("解析 provider 配置失败：{error}"))?;

  let maybe_key = match agent_id {
    "claude" => config_value
      .get("env")
      .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN").or_else(|| env.get("ANTHROPIC_API_KEY")))
      .and_then(Value::as_str),
    "codex" => config_value
      .get("auth")
      .and_then(|auth| auth.get("OPENAI_API_KEY"))
      .and_then(Value::as_str),
    _ => None,
  };

  Ok(maybe_key.filter(|value| !value.trim().is_empty()).map(ToString::to_string))
}

fn resolve_home_dir() -> Result<PathBuf, String> {
  #[cfg(target_os = "windows")]
  {
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
      return Ok(PathBuf::from(profile));
    }

    let home_drive = std::env::var_os("HOMEDRIVE").filter(|value| !value.is_empty());
    let home_path = std::env::var_os("HOMEPATH").filter(|value| !value.is_empty());
    if let (Some(home_drive), Some(home_path)) = (home_drive, home_path) {
      return Ok(PathBuf::from(format!(
        "{}{}",
        home_drive.to_string_lossy(),
        home_path.to_string_lossy()
      )));
    }

    Err("读取用户目录失败：未找到 USERPROFILE 或 HOMEDRIVE/HOMEPATH。".into())
  }

  #[cfg(not(target_os = "windows"))]
  {
    std::env::var_os("HOME")
      .filter(|value| !value.is_empty())
      .map(PathBuf::from)
      .ok_or_else(|| "读取用户目录失败：未找到 HOME。".into())
  }
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
      blocks.push(format!(
        "当前文件内容如下：\n```text\n{current_file_content}\n```"
      ));
    }
  }

  if !context.conversation_history.is_empty() {
    blocks.push(format!(
      "最近对话：\n{}",
      context.conversation_history.join("\n")
    ));
  }

  blocks.push(format!("用户问题：{prompt}"));
  blocks.join("\n\n")
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
    Duration::from_secs(45),
  )
}

fn run_claude_chat_no_log(
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
) -> Result<String, String> {
  let mut command = Command::new("claude");
  command
    .arg("-p")
    .arg("--output-format")
    .arg("text")
    .arg("--tools")
    .arg("")
    .env("ANTHROPIC_BASE_URL", DEFAULT_AGENT_BASE_URL)
    .env("ANTHROPIC_API_KEY", api_key)
    .env("ANTHROPIC_AUTH_TOKEN", api_key);

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
  let mut command = Command::new("claude");
  command
    .arg("-p")
    .arg("--output-format")
    .arg("text")
    .arg("--tools")
    .arg("")
    .env("ANTHROPIC_BASE_URL", DEFAULT_AGENT_BASE_URL)
    .env("ANTHROPIC_API_KEY", api_key)
    .env("ANTHROPIC_AUTH_TOKEN", api_key);

  if let Some(workspace_path) = workspace_path {
    command.arg("--add-dir").arg(workspace_path);
  }

  let output = run_command_with_timeout(
    app,
    request_id,
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
    Duration::from_secs(45),
  )
}

fn run_codex_chat_no_log(
  prompt: String,
  workspace_path: Option<&str>,
  api_key: &str,
  timeout: Duration,
) -> Result<String, String> {
  let temp_name = format!(
    "easy-ai-codex-{}.txt",
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0)
  );
  let output_path = std::env::temp_dir().join(temp_name);

  let mut command = Command::new("codex");
  command
    .arg("exec")
    .arg("--skip-git-repo-check")
    .arg("--color")
    .arg("never")
    .arg("--model")
    .arg(DEFAULT_CODEX_MODEL)
    .arg("-c")
    .arg(format!("base_url=\"{}\"", DEFAULT_AGENT_BASE_URL))
    .arg("-c")
    .arg(format!("openai_base_url=\"{}\"", DEFAULT_AGENT_BASE_URL))
    .arg("-o")
    .arg(&output_path)
    .env("OPENAI_API_KEY", api_key);

  if let Some(workspace_path) = workspace_path {
    command.arg("-C").arg(workspace_path);
  }

  command.arg(prompt);
  let output = run_command_with_timeout_silent(command, timeout, "Codex CLI", None)?;

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
  let temp_name = format!(
    "easy-ai-codex-{}.txt",
    SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .map(|duration| duration.as_millis())
      .unwrap_or(0)
  );
  let output_path = std::env::temp_dir().join(temp_name);

  let mut command = Command::new("codex");
  command
    .arg("exec")
    .arg("--skip-git-repo-check")
    .arg("--color")
    .arg("never")
    .arg("--model")
    .arg(DEFAULT_CODEX_MODEL)
    .arg("-c")
    .arg(format!("base_url=\"{}\"", DEFAULT_AGENT_BASE_URL))
    .arg("-c")
    .arg(format!("openai_base_url=\"{}\"", DEFAULT_AGENT_BASE_URL))
    .arg("-o")
    .arg(&output_path)
    .env("OPENAI_API_KEY", api_key);

  if let Some(workspace_path) = workspace_path {
    command.arg("-C").arg(workspace_path);
  }

  command.arg(prompt);
  let output = run_command_with_timeout(
    app,
    request_id,
    agent_id,
    command,
    timeout,
    "Codex CLI",
    None,
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

  let stdout_thread = child.stdout.take().map(|stdout_pipe| {
    let app = app.clone();
    let request_id = request_id.to_string();
    let agent_id = agent_id.to_string();
    let stdout_buffer = Arc::clone(&stdout_buffer);

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

        if stream_stdout_logs {
          emit_agent_log(&app, &request_id, &agent_id, "stdout", line.trim_end());
        }
      }
    })
  });

  let stderr_thread = child.stderr.take().map(|stderr_pipe| {
    let app = app.clone();
    let request_id = request_id.to_string();
    let agent_id = agent_id.to_string();
    let stderr_buffer = Arc::clone(&stderr_buffer);

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

        emit_agent_log(&app, &request_id, &agent_id, "stderr", line.trim_end());
      }
    })
  });

  let start = SystemTime::now();
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

    let elapsed = start.elapsed().unwrap_or_default();
    if elapsed >= timeout {
      let _ = child.kill();
      let _ = child.wait();
      return Err(format!("{label} 调用超时，请检查本机 CLI 是否可正常独立运行。"));
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
      run_agent_chat,
      install_agent,
      test_agent_connection,
      check_app_update,
      install_app_update
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
