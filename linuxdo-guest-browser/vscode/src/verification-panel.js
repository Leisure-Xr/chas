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
          capture: String(message.capture || ''),
          cookie: String(message.cookie || ''),
          userAgent: String(message.userAgent || ''),
          sourceHint: String(message.sourceHint || 'auto'),
          validate
        }), validate ? '档案已通过一次 /latest.json 测试并保存。' : '档案已保存，但尚未验证。');
        return;
      }
      if (message?.type === 'clear') {
        const target = ['cookie', 'userAgent', 'all'].includes(message.target) ? message.target : 'all';
        const confirmed = await vscode.window.showWarningMessage(
          target === 'all'
            ? '清除整个 Cloudflare 游客请求档案？'
            : `清除 ${target === 'cookie' ? 'Cookie' : 'User-Agent'} 会同时停用并删除整个原子请求档案，继续吗？`,
          { modal: true },
          '清除'
        );
        if (confirmed === '清除') await this.runBusy(() => this.handlers.clear(target), '游客请求档案已清除。');
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
<html lang="zh-CN"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>LINUX DO 验证设置</title>
  <style>
    *{box-sizing:border-box;letter-spacing:0}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font:13px/1.55 var(--vscode-font-family)}main{width:min(900px,100%);margin:auto;padding:26px clamp(16px,4vw,42px) 48px}h1{margin:0;font-size:21px}h2{margin:0 0 9px;font-size:14px}.lead{margin:5px 0 20px;color:var(--vscode-descriptionForeground)}section{padding:19px 0;border-top:1px solid var(--vscode-panel-border)}.notice,.summary{padding:10px 12px;border-left:3px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background);color:var(--vscode-descriptionForeground)}.summary{margin-top:12px;border-left-color:var(--vscode-testing-iconPassed,var(--vscode-textLink-foreground))}.steps{margin:0;padding-left:20px;color:var(--vscode-descriptionForeground)}.steps li+li{margin-top:5px}.field{margin-top:13px}label{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;font-weight:600}.saved,.hint{font-size:12px;font-weight:400;color:var(--vscode-descriptionForeground)}input,textarea,select{width:100%;padding:7px 9px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px;font:inherit}input,select{height:34px}textarea{min-height:150px;resize:vertical;font:12px/1.5 var(--vscode-editor-font-family)}.input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.source-row{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:8px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}button{min-height:32px;padding:5px 12px;border:1px solid transparent;border-radius:3px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit;cursor:pointer}button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}button.outline{color:var(--vscode-foreground);background:transparent;border-color:var(--vscode-panel-border)}button.danger{color:var(--vscode-errorForeground);background:transparent;border-color:var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}button:disabled,input:disabled,textarea:disabled,select:disabled{opacity:.55;cursor:default}.message{min-height:24px;margin:12px 0 0}.message.error{color:var(--vscode-errorForeground)}code{font:12px var(--vscode-editor-font-family)}@media(max-width:560px){main{padding-top:17px}.input-row,.source-row{grid-template-columns:1fr}.actions button{flex:1 1 42%}label{display:block}.saved{display:block}}
  </style>
</head><body><main>
  <h1>Cloudflare 游客请求档案</h1>
  <p class="lead">扩展不会启动 Chrome、Edge、Brave、ChromeDriver 或其他外部浏览器。</p>
  <p class="notice">请在浏览器完成验证，然后只复制同一个 <code>https://linux.do/latest.json</code> 的 XHR/fetch 请求。插件会把 Cookie、User-Agent 和客户端提示作为一个整体保存，绝不执行粘贴的 cURL。</p>

  <section>
    <h2>推荐：粘贴完整请求</h2>
    <ol class="steps">
      <li>打开 <code>https://linux.do/latest</code> 并完成 Cloudflare 验证，按 <code>F12</code> 打开 Network / 网络。</li>
      <li>在筛选框输入 <code>latest.json</code>，刷新页面，选择类型为 fetch/xhr 的精确请求；不要选名称为 <code>latest</code> 的 Document。</li>
      <li>右键该请求，选择 Copy / 复制 → Copy as cURL；也可在 Headers 中复制完整 Request Headers。</li>
      <li>粘贴到下方。Chrome、Edge、Brave 以及 Windows 的 <code>^</code>、PowerShell 的反引号续行均可解析。</li>
    </ol>
    <div class="field"><label for="capture">Request Headers 或 Copy as cURL</label><textarea id="capture" spellcheck="false" placeholder="curl 'https://linux.do/latest.json' ...&#10;&#10;或：&#10;cookie: cf_clearance=...&#10;user-agent: Mozilla/5.0 ...&#10;sec-ch-ua: ..."></textarea></div>
    <div class="field source-row"><span class="hint">cURL 只在本地解析，不会作为命令运行。</span><select id="source" aria-label="来源浏览器"><option value="auto">自动识别浏览器</option><option value="chrome">Chrome</option><option value="edge">Edge</option><option value="brave">Brave</option><option value="chromium">Chromium</option></select></div>
  </section>

  <section>
    <h2>备用：同时手动填写</h2>
    <div class="field"><label for="cookie">Cookie <span id="cookie-state" class="saved">读取中</span></label><div class="input-row"><input id="cookie" type="password" autocomplete="off" placeholder="修改时必须同时填写下方 User-Agent"><button id="reveal" class="outline" type="button">显示</button></div></div>
    <div class="field"><label for="ua">User-Agent <span id="ua-state" class="saved">读取中</span></label><input id="ua" type="text" autocomplete="off" placeholder="修改时必须同时填写上方 Cookie"></div>
    <p class="hint">两个输入框都留空时可重新测试已保存档案；只改其中一项会被拒绝，避免新 Cookie 与旧 UA 静默拼接。</p>
    <div id="profile" class="summary" hidden></div><div id="message" class="message" role="status"></div>
    <div class="actions"><button id="test" type="button">保存并测试一次</button><button id="save" class="secondary" type="button">仅保存为未验证</button><button id="clear-capture" class="outline" type="button">清空输入</button></div>
    <div class="actions"><button data-clear="cookie" class="danger" type="button">清除 Cookie</button><button data-clear="userAgent" class="danger" type="button">清除 User-Agent</button><button data-clear="all" class="danger" type="button">全部清除</button></div>
    <p class="hint">检测到登录 Cookie、Authorization、CSRF 或论坛 API 凭据时会拒绝整组导入。验证只请求一次 <code>/latest.json</code>；失败不会覆盖之前的有效档案。无标记 403 会报告为参数或浏览器指纹不兼容，不会伪装成 60 秒限流。</p>
  </section>
</main><script nonce="${nonce}">
  const vscode=acquireVsCodeApi(),capture=document.getElementById('capture'),cookie=document.getElementById('cookie'),ua=document.getElementById('ua'),source=document.getElementById('source'),message=document.getElementById('message'),profile=document.getElementById('profile');
  const send=validate=>vscode.postMessage({type:'save',capture:capture.value,cookie:cookie.value,userAgent:ua.value,sourceHint:source.value,validate});
  document.getElementById('reveal').addEventListener('click',event=>{const visible=cookie.type==='text';cookie.type=visible?'password':'text';event.currentTarget.textContent=visible?'显示':'隐藏'});
  document.getElementById('test').addEventListener('click',()=>send(true));document.getElementById('save').addEventListener('click',()=>send(false));
  document.getElementById('clear-capture').addEventListener('click',()=>{capture.value='';cookie.value='';ua.value='';message.textContent=''});
  document.querySelectorAll('[data-clear]').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'clear',target:button.dataset.clear})));
  window.addEventListener('message',event=>{const data=event.data;if(data.type==='state'){document.getElementById('cookie-state').textContent=data.hasCookie?'已保存（不回显）':'尚未保存';document.getElementById('ua-state').textContent=data.hasUserAgent?'已保存（不回显）':'尚未保存';const s=data.profileSummary;if(s){const state=s.status==='verified'?'已验证':s.status==='legacy-unverified'?'旧分项参数，待重新验证':'未验证';profile.hidden=false;profile.textContent='档案：'+s.browser+(s.major?' '+s.major:'')+' · '+s.platform+' · '+state+' · '+s.cookieNames.length+' 个白名单 Cookie · '+s.clientHintCount+' 个客户端提示 · 来源 '+s.source}else profile.hidden=true;if(data.status){message.textContent=data.status;message.className='message'}}if(data.type==='busy'){document.querySelectorAll('button,input,textarea,select').forEach(node=>node.disabled=Boolean(data.busy))}if(data.type==='result'){message.textContent=data.message||'';message.className='message'+(data.ok?'':' error');if(data.ok){capture.value='';cookie.value='';ua.value=''}}});
  vscode.postMessage({type:'ready'});
</script></body></html>`;
}

function randomNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return value;
}

module.exports = { VerificationPanel };
