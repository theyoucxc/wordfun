/* 词趣 WordFun — UI 层：视图切换、页面渲染、模态框、toast、下载、题目渲染 */
window.UI = (function () {
  'use strict';

  var PAGE_SIZE = 50;
  var libState = { query: '', page: 0 };

  var ICONS = {
    speaker: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
    speakerMute: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  // ===== 基础工具 =====
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function btn(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn' + (cls ? ' ' + cls : '');
    b.textContent = label;
    return b;
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function getView(name) {
    return document.getElementById('view-' + name);
  }

  function refresh() {
    if (window.App && window.App.refresh) window.App.refresh();
  }

  // ===== 视图切换 =====
  function showView(name) {
    ['dashboard', 'practice', 'library'].forEach(function (v) {
      getView(v).hidden = v !== name;
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === name);
    });
    document.body.classList.toggle('in-practice', name === 'practice');
    window.scrollTo(0, 0);
    if (name === 'dashboard') renderDashboard();
    if (name === 'library') renderLibrary();
  }

  function renderCurrent() {
    if (!getView('dashboard').hidden) renderDashboard();
    else if (!getView('library').hidden) renderLibrary();
  }

  // ===== Toast =====
  function toast(msg) {
    var root = document.getElementById('toast-root');
    var t = el('div', 'toast', msg);
    root.append(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // ===== 下载 =====
  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ===== 模态框 =====
  function openModal(opts) {
    var root = document.getElementById('modal-root');
    var overlay = el('div', 'modal-overlay');
    var card = el('div', 'modal');

    var head = el('div', 'modal-head');
    var title = el('h2', '', opts.title || '');
    var closeBtn = btn('', 'icon-btn');
    closeBtn.innerHTML = ICONS.x;
    closeBtn.setAttribute('aria-label', '关闭');
    head.append(title, closeBtn);

    var body = el('div', 'modal-body');
    card.append(head, body);

    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && opts.dismissable !== false) close();
    });

    if (opts.build) opts.build(body, close);
    if (opts.footer) {
      var foot = el('div', 'modal-foot');
      opts.footer(foot, close);
      card.append(foot);
    }
    overlay.append(card);
    root.append(overlay);
    return { close: close };
  }

  function confirm(opts) {
    openModal({
      title: opts.title || '确认',
      build: function (body) {
        body.append(el('div', 'modal-message', opts.message));
        if (opts.note) body.append(el('div', 'modal-note', opts.note));
      },
      footer: function (foot, close) {
        var cancel = btn('取消', '');
        var ok = btn(opts.confirmText || '确定', opts.danger ? 'btn-danger' : 'btn-primary');
        cancel.addEventListener('click', close);
        ok.addEventListener('click', function () {
          if (opts.onConfirm) opts.onConfirm();
          close();
        });
        foot.append(cancel, ok);
      }
    });
  }

  // ===== 表单字段 =====
  function mkField(label, input) {
    var lab = el('label', 'field');
    lab.append(el('span', 'field-label', label), input);
    return lab;
  }

  function mkInput(opts) {
    var i = document.createElement('input');
    i.className = 'input';
    i.type = opts.type || 'text';
    if (opts.placeholder) i.placeholder = opts.placeholder;
    if (opts.maxlength) i.maxLength = opts.maxlength;
    if (opts.required) i.required = true;
    if (opts.value !== undefined) i.value = opts.value;
    return i;
  }

  // ===== 首页仪表盘 =====
  function renderDashboard() {
    var view = getView('dashboard');
    view.textContent = '';

    var words = Store.getWords();
    var now = Date.now();

    if (!words.length) {
      var emptyCard = el('div', 'card');
      var empty = el('div', 'empty-state');
      empty.append(
        el('div', '', '词库还是空的'),
        el('div', '', '先导入你要学习的单词，再开始练习吧')
      );
      var goBtn = btn('去导入单词', 'btn-primary');
      goBtn.addEventListener('click', function () {
        showView('library');
        openImport();
      });
      empty.append(goBtn);
      emptyCard.append(empty);
      view.append(emptyCard);
      return;
    }

    // 今日卡片（按 CSV 天数规划）
    var override = Store.getStudyDay();   // 0 = 自动跟随进度；N = 手动跳转到第 N 天
    var session = SRS.buildSession(now);
    var studyDay = SRS.effectiveStudyDay();
    var maxDay = Store.maxStudyDay();
    var dayLabel = studyDay > 0 ? '第 ' + studyDay + ' 天' : '自由词';

    var card = el('div', 'card today-card');
    card.append(el('div', 'today-label', '今天 · ' + dayLabel));
    card.append(buildDayJump(override, maxDay));
    card.append(el('div', 'today-num', String(session ? session.newTotal : 0)));
    card.append(el('div', 'today-sub',
      '待学新词 ' + (session ? session.newTotal : 0) +
      ' · 待复习 ' + (session ? session.dueTotal : 0) +
      (session ? '' : ' · 今日任务全部完成')));
    var startBtn = btn(session ? '开始练习' : '今日任务完成', 'btn-primary btn-lg');
    if (!session) startBtn.disabled = true;
    else startBtn.addEventListener('click', function () { window.App.startSession(); });
    card.append(startBtn);
    view.append(card);

    // 上次未完成的练习（可继续）
    var saved = Store.getSession();
    if (saved && saved.queue && saved.queue.length) {
      var resumeBtn = btn('继续上次练习', 'resume-btn');
      resumeBtn.addEventListener('click', function () { window.App.resumeSession(); });
      view.append(resumeBtn);
    }

    // 统计行
    var summary = Store.getSummary();
    var statRow = el('div', 'stat-row');
    statRow.append(
      statCard(String(summary.total), '总词数'),
      statCard(String(summary.mastered), '已掌握'),
      statCard(summary.accuracy + '%', '正确率')
    );
    view.append(statRow);

    // 近 7 天柱状图
    view.append(buildChart());
  }

  // 天数跳跃：下拉选择学习天（「自动」= 跟随进度，学完当天自动进入下一天）
  function buildDayJump(override, maxDay) {
    var row = el('div', 'day-jump');
    var label = el('span', 'day-jump-label', '学习天');
    var select = document.createElement('select');
    select.className = 'day-jump-select';
    function opt(value, text) {
      var o = document.createElement('option');
      o.value = String(value);
      o.textContent = text;
      return o;
    }
    select.append(opt(0, '自动 · 跟随进度'));
    for (var d = 1; d <= maxDay; d++) select.append(opt(d, '第 ' + d + ' 天'));
    select.value = String(override);
    select.addEventListener('change', function () {
      Store.setStudyDay(Number(select.value));
      renderDashboard();
    });
    row.append(label, select);
    return row;
  }

  function statCard(num, label) {
    var c = el('div', 'card stat-card');
    c.append(el('div', 'stat-num', num), el('div', 'stat-label', label));
    return c;
  }

  // 近 7 天学习柱状图：单序列单色（天蓝）、柱顶圆角锚定基线、灰色文字标签、悬停提示
  function buildChart() {
    var card = el('div', 'card');
    card.append(el('div', 'chart-title', '近 7 天学习'));

    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    var values = days.map(function (d) {
      return Store.getDaily(Store.dateKey(d)).answered;
    });
    var maxVal = Math.max.apply(null, values.concat([1]));

    var chart = el('div', 'chart');
    days.forEach(function (d, i) {
      var v = values[i];
      var col = el('div', 'chart-col');
      var bar = el('div', 'chart-bar');
      var barH = v === 0 ? 4 : Math.max(6, Math.round(v / maxVal * 88));
      bar.style.height = barH + 'px';
      bar.setAttribute('title', (d.getMonth() + 1) + '月' + d.getDate() + '日：' + v + ' 题');
      bar.setAttribute('aria-label', '答题数 ' + v);
      if (v === 0) bar.classList.add('empty');
      var val = el('div', 'chart-val', String(v));
      var day = el('div', 'chart-day', (d.getMonth() + 1) + '/' + d.getDate());
      col.append(val, bar, day);
      chart.append(col);
    });
    card.append(chart);
    return card;
  }

  // ===== 词库管理页 =====
  function renderLibrary() {
    var view = getView('library');
    view.textContent = '';

    var bar = el('div', 'lib-bar');
    var search = mkInput({ placeholder: '搜索单词或词义' });
    search.value = libState.query;
    search.setAttribute('type', 'search');
    var count = el('span', 'lib-count');
    bar.append(search, count);

    var actions = el('div', 'lib-actions');
    var btnAdd = btn('添加单词', 'btn-primary');
    var btnImport = btn('批量导入', '');
    var btnCsv = btn('导出 CSV', '');
    btnAdd.addEventListener('click', function () { openWordForm(null); });
    btnImport.addEventListener('click', function () { openImport(); });
    btnCsv.addEventListener('click', function () {
      var words = Store.getWords();
      if (!words.length) { toast('词库为空，没有可导出的单词'); return; }
      downloadText('wordfun-words.csv', Importer.exportCSV(words));
      toast('已导出 ' + words.length + ' 个单词');
    });
    actions.append(btnAdd, btnImport, btnCsv);

    view.append(bar, actions);

    var words = Store.getWords();
    if (libState.query) {
      var q = libState.query.toLowerCase();
      words = words.filter(function (w) {
        return w.word.indexOf(q) !== -1 || w.meaning.toLowerCase().indexOf(q) !== -1;
      });
    }
    count.textContent = '共 ' + words.length + ' 词';

    var list = el('div', 'lib-list');
    if (!words.length) {
      var empty = el('div', 'card empty-state');
      empty.textContent = libState.query
        ? '没有匹配的单词'
        : '词库还是空的，点击上方「添加单词」或「批量导入」';
      list.append(empty);
    } else {
      var pages = Math.ceil(words.length / PAGE_SIZE);
      if (libState.page >= pages) libState.page = pages - 1;
      var pageWords = words.slice(libState.page * PAGE_SIZE, (libState.page + 1) * PAGE_SIZE);
      pageWords.forEach(function (w) { list.append(libRow(w)); });
      if (pages > 1) list.append(pager(libState.page, pages));
    }
    view.append(list);

    search.addEventListener('input', debounce(function () {
      libState.query = search.value.trim();
      libState.page = 0;
      renderLibrary();
    }, 200));
  }

  function libRow(w) {
    var row = el('div', 'lib-row');

    var main = el('div', 'lib-main');
    var wordline = el('div', 'lib-wordline');
    wordline.append(el('span', 'lib-word', w.word));
    if (w.day > 0) wordline.append(el('span', 'lib-day', '第' + w.day + '天'));
    main.append(wordline, el('div', 'lib-meaning', w.meaning));

    var meta = el('div', 'lib-meta');
    var badge = el('span', 'badge b' + w.box, String(w.box));
    badge.title = '熟练度 ' + w.box + ' 级（0-5）';
    var due = el('span', 'lib-due', SRS.relativeTimeText(w, Date.now()));
    if (SRS.isDue(w, Date.now()) && !SRS.isFresh(w)) due.classList.add('due');
    meta.append(badge, due);

    var ops = el('div', 'lib-ops');
    var editBtn = btn('编辑', 'btn-sm');
    var delBtn = btn('删除', 'btn-sm');
    editBtn.addEventListener('click', function () { openWordForm(w); });
    delBtn.addEventListener('click', function () {
      confirm({
        title: '删除单词',
        message: '确定删除「' + w.word + '」吗？学习记录将一并删除。',
        confirmText: '删除',
        danger: true,
        onConfirm: function () {
          Store.deleteWord(w.id);
          toast('已删除 ' + w.word);
          renderLibrary();
        }
      });
    });
    ops.append(editBtn, delBtn);

    row.append(main, meta, ops);
    return row;
  }

  function pager(page, pages) {
    var wrap = el('div', 'pager');
    var prev = btn('上一页', 'btn-sm page-btn');
    var next = btn('下一页', 'btn-sm page-btn');
    if (page === 0) prev.disabled = true;
    if (page >= pages - 1) next.disabled = true;
    prev.addEventListener('click', function () { libState.page--; renderLibrary(); });
    next.addEventListener('click', function () { libState.page++; renderLibrary(); });
    wrap.append(prev, el('span', 'page-info', (page + 1) + ' / ' + pages), next);
    return wrap;
  }

  // ===== 添加/编辑单词 =====
  function openWordForm(word) {
    var isEdit = !!word;
    var FORM_ID = 'wf-form';
    var m = openModal({
      title: isEdit ? '编辑单词' : '添加单词',
      build: function (body) {
        var form = document.createElement('form');
        form.id = FORM_ID;
        form.append(
          mkField('单词', mkInput({ placeholder: '如 apple', required: true, maxlength: 40, value: isEdit ? word.word : '' })),
          mkField('词义', mkInput({ placeholder: '如 n. 苹果', required: true, maxlength: 500, value: isEdit ? word.meaning : '' }))
        );
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var fields = {
            word: form.elements[0].value,
            meaning: form.elements[1].value
          };
          if (isEdit) {
            if (!Store.updateWord(word.id, fields)) { toast('单词格式不合法'); return; }
            toast('已保存');
          } else {
            var res = Store.addWord(fields);
            if (res.status === 'skipped') { toast(res.reason || '单词格式不合法'); return; }
            if (res.status === 'updated') toast('该词已存在，已合并更新');
            else toast('已添加');
          }
          m.close();
          refresh();
        });
        body.append(form);
      },
      footer: function (foot) {
        var cancel = btn('取消', '');
        cancel.addEventListener('click', function () { m.close(); });
        var saveBtn = btn('保存', 'btn-primary');
        saveBtn.setAttribute('form', FORM_ID);
        saveBtn.type = 'submit';
        foot.append(cancel, saveBtn);
      }
    });
  }

  // ===== 批量导入 =====
  function openImport() {
    var ta, resultWrap, importBtn;
    var m = openModal({
      title: '批量导入单词',
      build: function (body) {
        body.append(el('div', 'import-help',
          '每行一个单词，支持以下格式：\n' +
          '· 所属天/单元,单词,词义（课程 CSV，如「第1天 Unit 1 Lesson 1,act,v.行动」）\n' +
          '· 单词,词义（无天数的自由词）\n' +
          '· CSV 文件（Excel 可另存为 CSV 后导入）\n' +
          '带 * 的派生词会自动去掉 *；重复导入的单词会自动合并，不会丢失学习进度。'));

        ta = document.createElement('textarea');
        ta.className = 'input import-textarea';
        ta.placeholder = '第1天 Unit 1 Lesson 1,act,v.行动\napple,n. 苹果';
        body.append(ta);

        var fileRow = el('div', 'import-file-row');
        var fileBtn = btn('选择 CSV/TXT 文件', '');
        var fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.csv,.txt';
        fileInput.hidden = true;
        fileBtn.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', function () {
          if (!fileInput.files.length) return;
          Importer.fileToText(fileInput.files[0]).then(function (text) {
            ta.value = text;
            toast('文件已读取，可修改后导入');
          }).catch(function (e) {
            toast(e.message || '文件读取失败');
          });
        });
        fileRow.append(fileBtn, fileInput);
        body.append(fileRow);

        resultWrap = el('div', 'import-result');
        resultWrap.hidden = true;
        body.append(resultWrap);
      },
      footer: function (foot, close) {
        var cancel = btn('取消', '');
        cancel.addEventListener('click', close);
        importBtn = btn('导入', 'btn-primary');
        var imported = false;
        importBtn.addEventListener('click', function () {
          if (imported) { close(); return; }
          var parsed = Importer.parseText(ta.value);
          if (!parsed.rows.length && !parsed.skipped.length) {
            toast('没有可导入的内容');
            return;
          }
          var merged = Importer.mergeIntoStore(parsed.rows);
          resultWrap.hidden = false;
          resultWrap.textContent = '';
          resultWrap.append(el('div', 'import-summary',
            '新增 ' + merged.added + ' · 更新 ' + merged.updated + ' · 跳过 ' + parsed.skipped.length));
          if (parsed.skipped.length) {
            var skipList = el('div', 'skip-list');
            parsed.skipped.forEach(function (s) {
              skipList.append(el('div', 'skip-row',
                '第 ' + s.lineNo + ' 行：' + s.reason + '（' + truncate(s.line, 24) + '）'));
            });
            resultWrap.append(skipList);
          }
          refresh();
          if (merged.added || merged.updated) toast('导入完成');
          imported = true;
          importBtn.textContent = '完成';
        });
        foot.append(cancel, importBtn);
      }
    });
    return m;
  }

  // ===== 设置 =====
  function openSettings() {
    var s = Store.getSettings();
    openModal({
      title: '设置',
      build: function (body) {
        // 学习
        var g2 = el('div', 'set-group');
        g2.append(el('div', 'set-group-title', '学习'));

        var row4 = el('div', 'set-row');
        row4.append(el('div', 'set-row-label', '每场练习词数'));
        var inpSession = document.createElement('input');
        inpSession.type = 'number';
        inpSession.min = '5';
        inpSession.max = '30';
        inpSession.value = String(s.sessionSize);
        row4.append(inpSession);
        g2.append(row4);
        body.append(g2);

        // 数据备份
        var g3 = el('div', 'set-group');
        g3.append(el('div', 'set-group-title', '数据备份'));
        var row5 = el('div', 'set-row');
        var exportJsonBtn = btn('导出 JSON 备份', 'btn-sm');
        var importJsonBtn = btn('导入 JSON 备份', 'btn-sm');
        var jsonInput = document.createElement('input');
        jsonInput.type = 'file';
        jsonInput.accept = '.json,application/json';
        jsonInput.hidden = true;
        row5.append(exportJsonBtn, importJsonBtn, jsonInput);
        g3.append(row5);
        var row6 = el('div', 'set-row');
        var exportCsvBtn = btn('导出 CSV 词表', 'btn-sm');
        row6.append(exportCsvBtn);
        g3.append(row6);
        body.append(g3);

        // 危险区
        var g4 = el('div', 'set-group');
        g4.append(el('div', 'set-group-title', '危险区'));
        var clearBtn = btn('清空全部数据', 'btn-danger btn-sm');
        g4.append(clearBtn);
        body.append(g4);

        // 事件绑定
        inpSession.addEventListener('change', function () {
          Store.setSettings({ sessionSize: Number(inpSession.value) });
        });
        exportJsonBtn.addEventListener('click', function () {
          downloadText('wordfun-backup-' + Store.dateKey(new Date()) + '.json', Store.exportJSON());
          toast('备份已导出');
        });
        importJsonBtn.addEventListener('click', function () { jsonInput.click(); });
        jsonInput.addEventListener('change', function () {
          if (!jsonInput.files.length) return;
          jsonInput.files[0].text().then(function (text) {
            confirm({
              title: '导入备份',
              message: '导入将覆盖当前全部数据（词库、进度、统计），确定继续吗？',
              confirmText: '覆盖导入',
              danger: true,
              onConfirm: function () {
                var res = Store.importJSON(text);
                toast(res.ok ? '导入成功' : (res.error || '导入失败'));
                if (res.ok) refresh();
              }
            });
          });
        });
        exportCsvBtn.addEventListener('click', function () {
          var words = Store.getWords();
          if (!words.length) { toast('词库为空'); return; }
          downloadText('wordfun-words.csv', Importer.exportCSV(words));
        });
        clearBtn.addEventListener('click', function () {
          confirm({
            title: '清空全部数据',
            message: '将删除全部单词和学习记录，且无法恢复。建议先导出 JSON 备份。',
            confirmText: '清空',
            danger: true,
            onConfirm: function () {
              Store.clearAll();
              toast('已清空全部数据');
              refresh();
            }
          });
        });
      }
    });
  }

  // ===== 练习页 =====
  function renderPracticeHeader(total) {
    var view = getView('practice');
    view.textContent = '';

    var head = el('div', 'practice-head');
    var xBtn = btn('', 'icon-btn');
    xBtn.innerHTML = ICONS.x;
    xBtn.setAttribute('aria-label', '退出练习');
    xBtn.addEventListener('click', function () { window.App.confirmAbandon(); });
    var pbarWrap = el('div', 'pbar-wrap');
    var pbar = el('div', 'pbar');
    var fill = el('div', 'pbar-fill');
    fill.id = 'pbar-fill';
    pbar.append(fill);
    pbarWrap.append(pbar);
    head.append(xBtn, pbarWrap);

    var qwrap = el('div', 'q-wrap');
    qwrap.id = 'q-wrap';
    view.append(head, qwrap);
  }

  function updateProgress(done, total) {
    var fill = document.getElementById('pbar-fill');
    if (fill) fill.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  }

  function optionsList(choices, onAnswer) {
    var wrap = el('div', 'options');
    choices.forEach(function (c) {
      var b = btn(c.text, 'opt');
      b.addEventListener('click', function () { onAnswer(c.id); });
      wrap.append(b);
    });
    return wrap;
  }

  function skipButton(onSkip) {
    var b = btn('跳过此单词', 'skip-btn');
    b.setAttribute('title', '跳过此题，该词稍后再学');
    b.addEventListener('click', onSkip);
    return b;
  }

  function renderQuestion(q, h) {
    var wrap = document.getElementById('q-wrap');
    if (!wrap) return;
    wrap.textContent = '';

    var card = el('div', 'card q-card');
    if (q.id.slice(-2) === '_r') {
      card.append(el('div', 'q-retry-tag', '再试一次'));
    }

    if (q.type === 'choice') {
      card.append(el('div', 'q-prompt', q.promptText));
      if (q.subText) card.append(el('div', 'q-sub', q.subText));
      card.append(optionsList(q.choices, h.onAnswer));
      card.append(skipButton(h.onSkip));
    } else if (q.type === 'spelling') {
      card.append(el('div', 'q-prompt', q.promptText));
      if (q.subText) card.append(el('div', 'q-sub example', q.subText));
      var form = document.createElement('form');
      var formRow = el('div', 'spell-row');
      var input = mkInput({ placeholder: '输入单词的英文拼写', maxlength: 60 });
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');   // 移动端键盘不自动大写/纠错
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('enterkeyhint', 'go');
      var checkBtn = btn('检查', 'btn-primary');
      checkBtn.type = 'submit';   // 放入 form，点击即提交（Enter 亦触发同一 submit 处理）
      checkBtn.disabled = true;
      input.addEventListener('input', function () {
        checkBtn.disabled = !input.value.trim();
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!input.value.trim()) return;
        h.onSpell(input.value);
      });
      formRow.append(input, checkBtn);
      form.append(formRow);
      card.append(form);
      card.append(skipButton(h.onSkip));
      input.focus();
    } else if (q.type === 'matching') {
      card.append(el('div', 'q-sub', '点击左侧单词，再点击右侧对应的词义'));
      buildMatching(card, q, h);
    }

    wrap.append(card);
  }

  function buildMatching(card, q, h) {
    var grid = el('div', 'match-grid');
    var leftCol = el('div', 'match-col');
    var rightCol = el('div', 'match-col');
    var matchedL = {};
    var matchedR = {};
    var selLeft = null;
    var leftBtns = [];
    var order = q.rightOrder || q.pairs.map(function (_, i) { return i; }); // 旧会话兜底

    function doneCheck() {
      if (Object.keys(matchedL).length === q.pairs.length &&
          Object.keys(matchedR).length === q.pairs.length) {
        setTimeout(function () {
          h.onMatchingDone(q.pairs.map(function (p) {
            return { wordId: p.wordId, wrongAttempts: p.wrongAttempts };
          }));
        }, 300);
      }
    }

    // 左列：单词，保持原序
    q.pairs.forEach(function (p, i) {
      var lb = btn(p.left, 'match-item');
      lb.addEventListener('click', function () {
        if (matchedL[i] || selLeft !== null) return;
        selLeft = i;
        lb.classList.add('selected');
      });
      leftBtns.push(lb);
      leftCol.append(lb);
    });

    // 右列：词义，按 rightOrder 打乱显示
    order.forEach(function (pairIdx) {
      var p = q.pairs[pairIdx];
      var rb = btn(p.right, 'match-item');
      rb.addEventListener('click', function () {
        if (matchedR[pairIdx] || selLeft === null) return;
        var li = selLeft;
        if (q.pairs[li].right === p.right) {   // 左侧单词的真实词义 vs 右侧按钮显示词义
          matchedL[li] = true;
          matchedR[pairIdx] = true;
          selLeft = null;
          leftBtns[li].classList.add('ok');
          leftBtns[li].disabled = true;
          rb.classList.add('ok');
          rb.disabled = true;
          doneCheck();
        } else {
          q.pairs[li].wrongAttempts++;
          selLeft = null;
          leftBtns[li].classList.add('shake');
          rb.classList.add('shake');
          var lRef = leftBtns[li], rRef = rb;
          setTimeout(function () {
            lRef.classList.remove('shake', 'selected');
            rRef.classList.remove('shake');
          }, 400);
        }
      });
      rightCol.append(rb);
    });

    grid.append(leftCol, rightCol);
    card.append(grid);
  }

  // 反馈条：答对 800ms 自动继续；答错显示正确答案需点「继续」
  function showFeedback(correct, correctText, onNext) {
    // 收起移动端键盘，避免反馈条被键盘挡住
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    var root = document.getElementById('feedback-root');
    root.textContent = '';
    var bar = el('div', 'feedback ' + (correct ? 'ok' : 'bad'));
    bar.append(el('span', 'fb-icon', correct ? '✓' : '✕'));
    bar.append(el('span', 'fb-text', correct ? '回答正确' : '正确答案：' + correctText));
    var done = false;
    function go() {
      if (done) return;
      done = true;
      root.textContent = '';
      onNext();
    }
    if (correct) {
      setTimeout(go, 800);
    } else {
      var cont = btn('继续', 'fb-btn');
      cont.addEventListener('click', go);
      bar.append(cont);
    }
    root.append(bar);
  }

  // ===== 总结页 =====
  var TYPE_NAMES = { choice: '选择题', spelling: '拼写题', matching: '配对题' };

  function renderSummary(result) {
    var view = getView('practice');
    view.textContent = '';

    var card = el('div', 'card sum-card');
    card.append(el('div', 'sum-score', '答对 ' + result.correct + ' / ' + result.total));
    var accText = '正确率 ' + result.accuracy + '%';
    if (result.newLearned > 0) accText += ' · 新学 ' + result.newLearned + ' 词';
    card.append(el('div', 'sum-acc', accText));
    view.append(card);

    var typesCard = el('div', 'card');
    typesCard.append(el('div', 'sum-trans-title', '各题型表现'));
    var types = el('div', 'sum-types');
    Object.keys(TYPE_NAMES).forEach(function (k) {
      var v = result.byType[k];
      if (!v || !v.t) return;
      var row = el('div', 'sum-type-row');
      row.append(el('span', 'sum-type-name', TYPE_NAMES[k]));
      row.append(el('span', 'sum-type-score', v.c + ' / ' + v.t));
      types.append(row);
    });
    typesCard.append(types);
    view.append(typesCard);

    if (result.transitions.length) {
      var transCard = el('div', 'card');
      transCard.append(el('div', 'sum-trans-title', '本场变化'));
      var trans = el('div', 'sum-trans');
      result.transitions.forEach(function (t) {
        var w = Store.getWord(t.wordId);
        if (!w) return;
        var row = el('div', 'sum-trans-row');
        var text;
        if (t.correct) {
          text = t.word + '  ' + t.fromBox + '级 → ' + t.toBox + '级，' + SRS.relativeTimeText(w, Date.now()) + '复习';
          row.classList.add('up');
        } else {
          text = t.word + '  ' + t.fromBox + '级 → 0级，待重练';
          row.classList.add('down');
        }
        row.textContent = text;
        trans.append(row);
      });
      transCard.append(trans);
      view.append(transCard);
    }

    var btns = el('div', 'sum-btns');
    var again = btn('再来一场', 'btn-primary');
    again.addEventListener('click', function () { window.App.startSession(); });
    var home = btn('返回首页', '');
    home.addEventListener('click', function () { window.App.goHome(); });
    btns.append(again, home);
    view.append(btns);
  }

  return {
    showView: showView,
    renderCurrent: renderCurrent,
    renderDashboard: renderDashboard,
    renderLibrary: renderLibrary,
    renderPracticeHeader: renderPracticeHeader,
    updateProgress: updateProgress,
    renderQuestion: renderQuestion,
    showFeedback: showFeedback,
    renderSummary: renderSummary,
    openWordForm: openWordForm,
    openImport: openImport,
    openSettings: openSettings,
    confirm: confirm,
    toast: toast,
    downloadText: downloadText
  };
})();
