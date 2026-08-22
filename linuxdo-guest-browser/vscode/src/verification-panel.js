'use strict';

const vscode = require('vscode');

class VerificationPanel {
  static current;

  static createOrShow(context, handlers) {
    if (VerificationPanel.current) {
      VerificationPanel.current.handlers = handlers;
      VerificationPanel.current.panel.reveal(vscode.ViewColumn.One);
      void VerificationPanel.current.refresh();
      return VerificationPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'linuxdoGuest.verification',
      'LINUX DO 验证设置',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    VerificationPanel.current = new VerificationPanel(panel, context, handlers);
    return VerificationPanel.current;
  }

  constructor(panel, context, handlers) {
    this.panel = panel;
    this.handlers = handlers;
    panel.webview.html = getHtml(panel.webview);
    panel.onDidDispose(() => { VerificationPanel.current = undefined; }, null, context.subscriptions);
    panel.webview.onDidReceiveMessage((message) => void this.handleMessage(message), null, context.subscriptions);
  }

  async refresh(status) {
    const state = await this.handlers.getState();
    await this.panel.webview.postMessage({ type: 'state', ...state, status });
  }

  async handleMessage(message) {
    try {
      if (message?.type === 'ready') return this.refresh();
      if (message?.type === 'save') {
        const validate = Boolean(message.validate);
        await this.runBusy(() => this.handlers.save({
          cookie: String(message.cookie || ''),
          userAgent: String(message.userAgent || ''),
          validate
        }), validate ? '参数测试通过并已保存。' : '参数已保存；返回阅读器刷新即可使用。');
        return;
      }
      if (message?.type === 'clear') {
        const target = ['cookie', 'userAgent', 'all'].includes(message.target) ? message.target : 'all';
        const confirmed = await vscode.window.showWarningMessage(
          target === 'all' ? '清除全部 Cloudflare 游客参数？' : `清除已保存的 ${target === 'cookie' ? 'Cookie' : 'User-Agent'}？`,
          { modal: true },
          '清除'
        );
        if (confirmed === '清除') await this.runBusy(() => this.handlers.clear(target), '对应参数已清除。');
      }
    } catch (error) {
      await this.panel.webview.postMessage({
        type: 'result',
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      });
      await this.refresh();
    }
  }

  async runBusy(operation, successMessage) {
    await this.panel.webview.postMessage({ type: 'busy', busy: true });
    try {
      await operation();
      await this.panel.webview.postMessage({ type: 'result', ok: true, message: successMessage });
      await this.refresh(successMessage);
    } finally {
      await this.panel.webview.postMessage({ type: 'busy', busy: false });
    }
  }
}

function getHtml(webview) {
  const nonce = randomNonce();
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>LINUX DO 验证设置</title>
  <style>
    *{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.55 var(--vscode-font-family)}main{width:min(840px,100%);margin:auto;padding:28px clamp(16px,4vw,42px) 48px}h1{margin:0;font-size:21px;letter-spacing:0}h2{margin:0 0 10px;font-size:14px;letter-spacing:0}.lead{margin:5px 0 22px;color:var(--vscode-descriptionForeground)}.notice{padding:10px 12px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background);color:var(--vscode-descriptionForeground)}section{padding:20px 0;border-top:1px solid var(--vscode-panel-border)}.steps{margin:0;padding-left:20px;color:var(--vscode-descriptionForeground)}.steps li+li{margin-top:5px}.field{margin-top:14px}label{display:flex;justify-content:space-between;gap:12px;margin-bottom:6px;font-weight:600}.saved{font-size:12px;font-weight:400;color:var(--vscode-descriptionForeground)}input,textarea{width:100%;padding:7px 9px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px;font:inherit}input{height:34px}textarea{min-height:112px;resize:vertical;font-family:var(--vscode-editor-font-family);font-size:12px}.input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.actions{display:flex;flex-wrap:wrap;gap:8px}.actions.secondary{margin-top:9px}button{min-height:32px;padding:5px 12px;border:1px solid transparent;border-radius:3px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button.outline{color:var(--vscode-foreground);background:transparent;border-color:var(--vscode-button-border,var(--vscode-panel-border))}button.danger{color:var(--vscode-errorForeground);background:transparent;border-color:var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}button:disabled,input:disabled,textarea:disabled{opacity:.55;cursor:default}.hint{margin:6px 0 0;font-size:12px;color:var(--vscode-descriptionForeground)}.message{min-height:24px;margin:14px 0 4px;padding:4px 0}.message.error{color:var(--vscode-errorForeground)}code{font-family:var(--vscode-editor-font-family);font-size:12px}@media(max-width:560px){main{padding-top:18px}.input-row{grid-template-columns:1fr}.actions button{flex:1 1 42%}label{display:block}.saved{display:block;margin-top:2px}}
  </style>
</head>
<body><main>
  <h1>Cloudflare 游客参数</h1>
  <p class="lead">所有操作都在 VS Code 内完成；扩展不会启动 Chrome、Edge、Brave 或其他浏览器进程。</p>
  <p class="notice">VS Code Webview 不能读取系统浏览器 Cookie。请在你自己的浏览器完成验证后，从开发者工具复制请求标头，再粘贴到下方解析。</p>

  <section>
    <h2>从浏览器检查面板获取</h2>
    <ol class="steps">
      <li>在 Chrome、Edge 或 Brave 打开 <code>https://linux.do/latest</code>，完成 Cloudflare 验证。</li>
      <li>按 <code>F12</code>，打开 <strong>Network / 网络</strong>，刷新页面并选中名称为 <code>latest</code> 的文档请求。</li>
      <li>在 <strong>Headers / 标头</strong> 中找到 <strong>Request Headers / 请求标头</strong>，复制完整的 <code>cookie</code> 和 <code>user-agent</code>；也可右键请求选择 <strong>Copy request headers</strong>。</li>
      <li>把复制内容粘贴到下面，点击“解析标头”。获取参数后不要退出或重新验证该浏览器，否则 Cookie 可能变化。</li>
    </ol>
    <div class="field">
      <label for="headers">请求标头（可选）</label>
      <textarea id="headers" spellcheck="false" placeholder="cookie: cf_clearance=...; _forum_session=...&#10;user-agent: Mozilla/5.0 ..."></textarea>
      <div class="actions secondary"><button id="parse" class="secondary" type="button">解析标头</button><button id="clear-headers" class="outline" type="button">清空标头</button></div>
    </div>
  </section>

  <section>
    <h2>确认并保存</h2>
    <div class="field">
      <label for="cookie">Cookie <span id="cookie-state" class="saved">尚未读取状态</span></label>
      <div class="input-row"><input id="cookie" type="password" autocomplete="off" placeholder="留空表示保留已保存 Cookie"><button id="reveal" class="outline" type="button">显示</button></div>
      <p class="hint">只保存 Cloudflare 白名单字段和未登录的匿名论坛会话；登录令牌与 Stripe 字段会被丢弃。</p>
    </div>
    <div class="field">
      <label for="ua">User-Agent <span id="ua-state" class="saved">尚未读取状态</span></label>
      <input id="ua" type="text" autocomplete="off" placeholder="Mozilla/5.0 ...">
      <p class="hint">也可在同一浏览器 Console / 控制台执行 <code>navigator.userAgent</code>。</p>
    </div>
    <div id="message" class="message" role="status"></div>
    <div class="actions">
      <button id="test" type="button">保存并测试</button><button id="save" class="secondary" type="button">仅保存</button>
      <button data-clear="cookie" class="danger" type="button">清除 Cookie</button><button data-clear="userAgent" class="danger" type="button">清除 User-Agent</button><button data-clear="all" class="danger" type="button">全部清除</button>
    </div>
    <p class="hint">“保存并测试”会从 VS Code 请求公开的 <code>/latest.json</code>。若 Cloudflare 仍拒绝，但你确认参数完整，可先“仅保存”再回阅读器刷新。VS Code 不会代替你打开或控制浏览器。</p>
  </section>
</main>
<script nonce="${nonce}">
  const vscode=acquireVsCodeApi(),cookie=document.getElementById('cookie'),ua=document.getElementById('ua'),headers=document.getElementById('headers'),message=document.getElementById('message');
  document.getElementById('reveal').addEventListener('click',event=>{const visible=cookie.type==='text';cookie.type=visible?'password':'text';event.currentTarget.textContent=visible?'显示':'隐藏'});
  document.getElementById('parse').addEventListener('click',()=>{const raw=headers.value.replace(/\\r/g,'');const cookieMatch=raw.match(/(?:^|\\n)\\s*cookie\\s*:\\s*([^\\n]+)/i);const uaMatch=raw.match(/(?:^|\\n)\\s*user-agent\\s*:\\s*([^\\n]+)/i);if(cookieMatch)cookie.value=cookieMatch[1].trim();if(uaMatch)ua.value=uaMatch[1].trim();message.textContent=cookieMatch&&uaMatch?'已解析 Cookie 和 User-Agent，请确认后保存。':'未同时找到 cookie 与 user-agent，请确认复制的是 Request Headers。';message.className='message'+(cookieMatch&&uaMatch?'':' error')});
  document.getElementById('clear-headers').addEventListener('click',()=>{headers.value=''});
  document.getElementById('test').addEventListener('click',()=>vscode.postMessage({type:'save',cookie:cookie.value,userAgent:ua.value,validate:true}));
  document.getElementById('save').addEventListener('click',()=>vscode.postMessage({type:'save',cookie:cookie.value,userAgent:ua.value,validate:false}));
  document.querySelectorAll('[data-clear]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'clear',target:button.dataset.clear})));
  window.addEventListener('message',event=>{const data=event.data;if(data.type==='state'){document.getElementById('cookie-state').textContent=data.hasCookie?'已保存；留空不会覆盖':'尚未保存';document.getElementById('ua-state').textContent=data.hasUserAgent?'已保存；留空不会覆盖':'尚未保存';if(data.status){message.textContent=data.status;message.className='message'}}if(data.type==='busy'){document.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=Boolean(data.busy))}if(data.type==='result'){message.textContent=data.message||'';message.className='message'+(data.ok?'':' error');if(data.ok){cookie.value='';ua.value='';headers.value=''}}});
  vscode.postMessage({type:'ready'});
</script></body></html>`;
}

function randomNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 32; i += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}

module.exports = { VerificationPanel };
