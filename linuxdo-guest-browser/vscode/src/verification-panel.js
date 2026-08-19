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
        await this.runBusy(() => this.handlers.save({
          cookie: String(message.cookie || ''),
          userAgent: String(message.userAgent || ''),
          browserKind: String(message.browserKind || 'auto')
        }), '手动参数已通过浏览器内请求校验并保存。');
        return;
      }
      if (message?.type === 'auto') {
        await this.runBusy(() => this.handlers.auto(String(message.browserKind || 'auto')), '自动验证成功。');
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
    *{box-sizing:border-box}body{margin:0;padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.5 var(--vscode-font-family)}main{max-width:760px;margin:auto}h1{font-size:20px;margin:0 0 6px}p{color:var(--vscode-descriptionForeground)}.section{padding:18px 0;border-top:1px solid var(--vscode-panel-border)}.section:first-of-type{margin-top:20px}label{display:block;font-weight:600;margin:0 0 6px}.row{display:flex;gap:8px;align-items:center}.row>*:first-child{flex:1}input,select{width:100%;height:32px;padding:5px 8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:2px}button{min-height:32px;padding:5px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:2px;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button.danger{color:var(--vscode-errorForeground);background:transparent;border:1px solid var(--vscode-errorForeground)}button:disabled{opacity:.55;cursor:default}.state{font-size:12px;color:var(--vscode-descriptionForeground);margin-top:5px}.actions{display:flex;flex-wrap:wrap;gap:8px}.message{min-height:22px;margin:14px 0}.message.error{color:var(--vscode-errorForeground)}code{font-family:var(--vscode-editor-font-family)}@media(max-width:520px){body{padding:15px}.row{align-items:stretch;flex-direction:column}.actions button{flex:1 1 45%}}
  </style>
</head>
<body><main>
  <h1>Cloudflare 游客验证</h1>
  <p>手动参数优先。Cookie 和 User-Agent 必须来自同一个浏览器；扩展只保存游客白名单字段。</p>
  <section class="section">
    <label for="browser">参数来源浏览器</label>
    <select id="browser"><option value="auto">自动选择</option><option value="chrome">Google Chrome</option><option value="edge">Microsoft Edge</option><option value="brave">Brave</option><option value="chromium">Chromium</option></select>
  </section>
  <section class="section">
    <label for="cookie">Cookie 或 cf_clearance</label>
    <div class="row"><input id="cookie" type="password" autocomplete="off" placeholder="留空表示保留已保存的 Cookie"><button id="reveal" class="secondary" type="button">显示</button></div>
    <div id="cookie-state" class="state">尚未读取状态</div>
  </section>
  <section class="section">
    <label for="ua">User-Agent</label>
    <input id="ua" type="text" autocomplete="off" placeholder="留空表示保留已保存的 User-Agent">
    <div id="ua-state" class="state">在浏览器控制台执行 <code>navigator.userAgent</code> 获取。</div>
  </section>
  <div id="message" class="message" role="status"></div>
  <div class="actions">
    <button id="save" type="button">保存并验证</button><button id="auto" class="secondary" type="button">自动验证（备用）</button>
    <button data-clear="cookie" class="danger" type="button">清除 Cookie</button><button data-clear="userAgent" class="danger" type="button">清除 User-Agent</button><button data-clear="all" class="danger" type="button">全部清除</button>
  </div>
</main>
<script nonce="${nonce}">
  const vscode=acquireVsCodeApi(),cookie=document.getElementById('cookie'),ua=document.getElementById('ua'),browser=document.getElementById('browser'),message=document.getElementById('message');
  document.getElementById('reveal').addEventListener('click',event=>{const visible=cookie.type==='text';cookie.type=visible?'password':'text';event.currentTarget.textContent=visible?'显示':'隐藏'});
  document.getElementById('save').addEventListener('click',()=>vscode.postMessage({type:'save',cookie:cookie.value,userAgent:ua.value,browserKind:browser.value}));
  document.getElementById('auto').addEventListener('click',()=>vscode.postMessage({type:'auto',browserKind:browser.value}));
  document.querySelectorAll('[data-clear]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'clear',target:button.dataset.clear})));
  window.addEventListener('message',event=>{const data=event.data;if(data.type==='state'){browser.value=data.browserKind||'auto';document.getElementById('cookie-state').textContent=data.hasCookie?'已保存游客 Cookie；留空不会覆盖。':'尚未保存 Cookie。';document.getElementById('ua-state').textContent=data.hasUserAgent?'已保存 User-Agent；留空不会覆盖。':'尚未保存 User-Agent。';if(data.status){message.textContent=data.status;message.className='message'}}if(data.type==='busy'){document.querySelectorAll('button,input,select').forEach(node=>node.disabled=Boolean(data.busy))}if(data.type==='result'){message.textContent=data.message||'';message.className='message'+(data.ok?'':' error');if(data.ok){cookie.value='';ua.value=''}}});
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
