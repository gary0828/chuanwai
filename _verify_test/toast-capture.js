/**
 * UI 测试用的 toast 捕获脚本（注入到页面里执行）。
 *
 * ★ 为什么要独立成文件：之前把这个 JS 写在 Python 三引号字符串里，
 *   `\\n` / `/\\n/g` 会被 Python 与 JS 双重转义搞坏
 *   （实测报 `Invalid regular expression: missing /`）。
 *   ⇒ **跨语言的转义地狱只有一个解法：别在一个语言里嵌另一个语言。**
 *
 * 用法：page.add_script_tag(path=__file__) 后调用 startCaptureToast()。
 */
window.__qbToasts = [];

window.__qbToastObserver = null;

/** 开始捕获 ElMessage（必须在触发动作**之前**调用） */
window.__qbStartToastCapture = function () {
  window.__qbToasts = [];
  if (window.__qbToastObserver) {
    window.__qbToastObserver.disconnect();
  }
  var scan = function () {
    var nodes = document.querySelectorAll(".el-message");
    for (var i = 0; i < nodes.length; i += 1) {
      var n = nodes[i];
      if (!n) continue;
      var raw = n.innerText || n.textContent || "";
      var t = raw.trim().replace(/\s+/g, " ");
      if (t && window.__qbToasts.indexOf(t) === -1) {
        window.__qbToasts.push(t);
      }
    }
  };
  // 先扫一次（toast 可能已在DOM 里），再挂监听
  scan();

  //★ 用 rAF 轮询兜底，而不是只靠 MutationObserver ——
  //   ElMessage 通过 Vue 的 Teleport 挂到 body 下，transition 期间节点可能先插入
  //   再改内容，MutationObserver 在「移除」之后才回调的场景会漏。
  //   实测（2026-10-07）：MutationObserver 方案捕获到空数组，rAF 轮询立刻抓到。
  var stop = false;
  function loop() {
    if (stop) return;
    scan();
    window.requestAnimationFrame(loop);
  }
  window.requestAnimationFrame(loop);

  if (window.__qbToastObserver) {
    window.__qbToastObserver.disconnect();
  }
  window.__qbToastObserver = new MutationObserver(function () {
    scan();
  });
  window.__qbToastObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  window.__qbToastStop = function () { stop = true; };
};

/** 读取捕获到的 toast 列表 */
window.__qbReadToasts = function () {
  return window.__qbToasts || [];
};