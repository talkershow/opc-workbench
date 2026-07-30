/* ========== OPC 工作台 · 核心应用逻辑 ========== */
(function() {
  'use strict';

  // ========== 数据管理 ==========
  var DB = {
    topics: [],
    dataRecords: [],
    reviews: [],
    dailyReviews: [],
    inboxItems: [],
    settings: { lastReviewWeek: '' },

    load: function() {
      try {
        this.topics = JSON.parse(localStorage.getItem('opc_topics') || '[]');
        this.dataRecords = JSON.parse(localStorage.getItem('opc_data') || '[]');
        this.reviews = JSON.parse(localStorage.getItem('opc_reviews') || '[]');
        this.dailyReviews = JSON.parse(localStorage.getItem('opc_daily') || '[]');
        this.inboxItems = JSON.parse(localStorage.getItem('opc_inbox') || '[]');
        this.settings = JSON.parse(localStorage.getItem('opc_settings') || '{}');
        if (!this.settings.lastReviewWeek) this.settings.lastReviewWeek = '';
      } catch(e) {
        console.warn('数据加载失败', e);
      }
    },

    save: function(type) {
      if (type === 'topics' || !type) localStorage.setItem('opc_topics', JSON.stringify(this.topics));
      if (type === 'data' || !type) localStorage.setItem('opc_data', JSON.stringify(this.dataRecords));
      if (type === 'reviews' || !type) localStorage.setItem('opc_reviews', JSON.stringify(this.reviews));
      if (type === 'daily' || !type) localStorage.setItem('opc_daily', JSON.stringify(this.dailyReviews));
      if (type === 'inbox' || !type) localStorage.setItem('opc_inbox', JSON.stringify(this.inboxItems));
      if (!type) localStorage.setItem('opc_settings', JSON.stringify(this.settings));
      // 触发自动同步
      if (typeof Sync !== 'undefined') Sync.scheduleAutoSync();
    },

    genId: function() {
      return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    },

    addTopic: function(t) {
      t.id = this.genId();
      t.createdAt = new Date().toISOString();
      this.topics.unshift(t);
      this.save('topics');
      return t;
    },

    updateTopic: function(id, updates) {
      var t = this.topics.find(function(x) { return x.id === id; });
      if (t) { Object.assign(t, updates); this.save('topics'); }
      return t;
    },

    deleteTopic: function(id) {
      this.topics = this.topics.filter(function(x) { return x.id !== id; });
      this.save('topics');
    },

    addData: function(d) {
      d.id = this.genId();
      d.createdAt = new Date().toISOString();
      this.dataRecords.unshift(d);
      this.save('data');
      return d;
    },

    deleteData: function(id) {
      this.dataRecords = this.dataRecords.filter(function(x) { return x.id !== id; });
      this.save('data');
    },

    addReview: function(r) {
      r.id = this.genId();
      r.createdAt = new Date().toISOString();
      this.reviews.unshift(r);
      this.save('reviews');
    }
  };

  // ========== GitHub 同步模块 ==========
  var Sync = {
    config: { username: '', repo: '', branch: 'main', token: '', autoSync: true },
    fileSha: null,       // 远程 data.json 的 SHA（更新时需要）
    lastSyncAt: null,    // 上次同步时间
    debounceTimer: null,
    syncing: false,

    DATA_FILE: 'data.json',
    API_BASE: 'https://api.github.com',

    loadConfig: function() {
      try {
        var saved = JSON.parse(localStorage.getItem('opc_sync_config') || '{}');
        this.config = Object.assign(this.config, saved);
        this.lastSyncAt = localStorage.getItem('opc_sync_last') || null;
      } catch(e) {}
    },

    saveConfig: function() {
      localStorage.setItem('opc_sync_config', JSON.stringify(this.config));
    },

    isConfigured: function() {
      return this.config.username && this.config.repo && this.config.token;
    },

    // 收集所有数据
    collectData: function() {
      return {
        topics: DB.topics,
        dataRecords: DB.dataRecords,
        reviews: DB.reviews,
        dailyReviews: DB.dailyReviews,
        inboxItems: DB.inboxItems,
        settings: DB.settings,
        exportedAt: new Date().toISOString()
      };
    },

    // Base64 编解码（UTF-8 安全）
    encode: function(str) {
      return btoa(unescape(encodeURIComponent(str)));
    },
    decode: function(b64) {
      return decodeURIComponent(escape(atob(b64)));
    },

    // API 请求
    api: function(method, path, body) {
      var url = this.API_BASE + path;
      var opts = {
        method: method,
        headers: {
          'Authorization': 'token ' + this.config.token,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        }
      };
      if (body) opts.body = JSON.stringify(body);
      return fetch(url, opts).then(function(r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('GitHub API ' + r.status);
        return r.json();
      });
    },

    // 推送数据到 GitHub
    push: function() {
      if (!this.isConfigured()) {
        showToast('请先配置 GitHub 同步');
        return Promise.reject(new Error('未配置'));
      }
      if (this.syncing) return Promise.reject(new Error('同步中'));
      this.syncing = true;
      this.updateIndicator('syncing');

      var self = this;
      var path = '/repos/' + this.config.username + '/' + this.config.repo +
                 '/contents/' + this.DATA_FILE;
      var data = this.collectData();
      var content = this.encode(JSON.stringify(data, null, 2));

      // 先获取当前文件的 SHA（如果存在）
      return this.api('GET', path).then(function(fileInfo) {
        self.fileSha = fileInfo ? fileInfo.sha : null;

        // PUT 更新或创建文件
        return self.api('PUT', path, {
          message: 'OPC数据同步 ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
          content: content,
          sha: self.fileSha,
          branch: self.config.branch
        });
      }).then(function() {
        self.lastSyncAt = new Date().toISOString();
        localStorage.setItem('opc_sync_last', self.lastSyncAt);
        self.syncing = false;
        self.updateIndicator('synced');
        return true;
      }).catch(function(err) {
        self.syncing = false;
        self.updateIndicator('error');
        throw err;
      });
    },

    // 从 GitHub 拉取数据
    pull: function() {
      if (!this.isConfigured()) {
        showToast('请先配置 GitHub 同步');
        return Promise.reject(new Error('未配置'));
      }

      var self = this;
      var path = '/repos/' + this.config.username + '/' + this.config.repo +
                 '/contents/' + this.DATA_FILE + '?ref=' + this.config.branch;

      return this.api('GET', path).then(function(fileInfo) {
        if (!fileInfo) {
          showToast('远程无数据，请先推送');
          return false;
        }
        self.fileSha = fileInfo.sha;
        var data = JSON.parse(self.decode(fileInfo.content));

        // 合并到本地
        if (data.topics) DB.topics = data.topics;
        if (data.dataRecords) DB.dataRecords = data.dataRecords;
        if (data.reviews) DB.reviews = data.reviews;
        if (data.dailyReviews) DB.dailyReviews = data.dailyReviews;
        if (data.inboxItems) DB.inboxItems = data.inboxItems;
        if (data.settings) DB.settings = data.settings;
        DB.save();

        self.lastSyncAt = new Date().toISOString();
        localStorage.setItem('opc_sync_last', self.lastSyncAt);
        self.updateIndicator('synced');
        showToast('数据已从 GitHub 拉取');
        return true;
      });
    },

    // 测试连接
    test: function() {
      if (!this.isConfigured()) {
        showToast('请先填写配置');
        return;
      }
      var self = this;
      showToast('测试中...');
      this.api('GET', '/repos/' + this.config.username + '/' + this.config.repo).then(function(repo) {
        if (repo) {
          showToast('✅ 连接成功！仓库：' + repo.full_name);
          self.updateIndicator('synced');
        } else {
          showToast('⚠ 仓库不存在或无权限');
        }
      }).catch(function() {
        showToast('❌ 连接失败，请检查配置');
      });
    },

    // 自动同步（防抖）
    scheduleAutoSync: function() {
      if (!this.config.autoSync || !this.isConfigured()) return;
      var self = this;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(function() {
        self.push().then(function() {
          console.log('[OPC] 自动同步成功');
        }).catch(function(err) {
          console.warn('[OPC] 自动同步失败', err);
        });
      }, 5000);
    },

    // 更新顶栏指示器
    updateIndicator: function(state) {
      var dot = $('syncDot');
      var text = $('syncText');
      var indicator = $('syncIndicator');
      if (!dot || !text) return;

      indicator.style.display = 'flex';

      var states = {
        syncing: { color: '#f59e0b', text: '同步中...' },
        synced: { color: '#10b981', text: '已同步' },
        error: { color: '#ef4444', text: '同步失败' },
        offline: { color: '#9ca3af', text: '未连接' }
      };
      var s = states[state] || states.offline;
      dot.style.background = s.color;
      text.textContent = s.text;

      if (this.lastSyncAt && state === 'synced') {
        var t = new Date(this.lastSyncAt);
        text.textContent = '已同步 ' + t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0');
      }
    },

    // 打开设置面板时加载配置
    openSettings: function() {
      $('sync-username').value = this.config.username || '';
      $('sync-repo').value = this.config.repo || '';
      $('sync-branch').value = this.config.branch || 'main';
      $('sync-token').value = this.config.token || '';
      $('sync-auto').checked = this.config.autoSync;

      // 更新状态显示
      if (this.isConfigured()) {
        $('syncStatusIcon').textContent = '🟢';
        $('syncStatusText').textContent = '已配置 - 仓库: ' + this.config.username + '/' + this.config.repo;
        if (this.lastSyncAt) {
          $('syncLastTime').textContent = '上次同步: ' + new Date(this.lastSyncAt).toLocaleString('zh-CN');
        }
      } else {
        $('syncStatusIcon').textContent = '⚪';
        $('syncStatusText').textContent = '未配置同步';
        $('syncLastTime').textContent = '';
      }

      $('syncModal').classList.add('show');
    }
  };

  // ========== 工具函数 ==========
  function $(id) { return document.getElementById(id); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showToast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 2200);
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return n.toString();
  }

  function getWeekLabel() {
    var now = new Date();
    var year = now.getFullYear();
    var start = new Date(year, 0, 1);
    var diff = (now - start) / 86400000;
    var week = Math.ceil((diff + start.getDay() + 1) / 7);
    return 'W' + week + ' (' + (now.getMonth() + 1) + '/' + now.getDate() + ')';
  }

  function getEngagementRate(d) {
    if (!d.views || d.views === 0) return 0;
    return ((d.likes || 0) + (d.comments || 0) + (d.shares || 0) + (d.favorites || 0)) / d.views;
  }

  function scoreTag(score) {
    if (score >= 60) return '<span class="tag tag-green">' + score + ' 优先</span>';
    if (score >= 40) return '<span class="tag tag-yellow">' + score + ' 中等</span>';
    return '<span class="tag tag-muted">' + score + ' 低</span>';
  }

  // ========== 主题管理 ==========
  function updateThemeControl() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    var button = $('themeToggle');
    var icon = $('themeIcon');
    if (!button || !icon) return;
    icon.textContent = isLight ? '☾' : '☀';
    button.title = isLight ? '切换深色主题' : '切换浅色主题';
    button.setAttribute('aria-label', button.title);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme') || 'dark';
    var next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('opc_theme', next);
    updateThemeControl();

    var activePage = document.querySelector('.page.active');
    if (activePage && activePage.id === 'page-dashboard') renderDashboard();
    if (activePage && activePage.id === 'page-data') renderDataPage();
  }

  window.toggleTheme = toggleTheme;

  // ========== 导航 ==========
  var pageTitles = {
    dashboard: '仪表盘',
    inbox: '数据邮箱',
    topics: '选题看板',
    board: '内容看板',
    data: '数据追踪',
    review: '周复盘',
    toolkit: 'SOP 工具箱'
  };

  function navigate(page) {
    $$('.page').forEach(function(p) { p.classList.remove('active'); });
    $$('.nav-item').forEach(function(n) { n.classList.remove('active'); });
    $('page-' + page).classList.add('active');
    var navItem = document.querySelector('.nav-item[data-page="' + page + '"]');
    if (navItem) navItem.classList.add('active');
    $('pageTitle').textContent = pageTitles[page] || page;
    if (page === 'dashboard') renderDashboard();
    if (page === 'inbox') renderInbox();
    if (page === 'topics') renderTopics();
    if (page === 'board') renderBoard();
    if (page === 'data') renderDataPage();
    if (page === 'review') renderReviewPage();
    if (page === 'toolkit') renderToolkit();
    // 移动端关闭侧边栏
    document.querySelector('.sidebar').classList.remove('open');
    window.scrollTo(0, 0);
  }

  // ========== 仪表盘 ==========
  function renderDashboard() {
    var topics = DB.topics;
    var data = DB.dataRecords;

    // 统计卡片
    var published = topics.filter(function(t) { return t.status === '已发布'; });
    var ready = topics.filter(function(t) { return t.status === '待评估' || t.status === '灵感'; });
    $('dash-topic-count').textContent = topics.length;
    $('dash-topic-ready').textContent = '待评估 ' + ready.length + ' 个';

    $('dash-published-count').textContent = published.length;
    var now = new Date();
    var weekAgo = new Date(now.getTime() - 7 * 86400000);
    var weekPublished = data.filter(function(d) {
      return new Date(d.date) >= weekAgo;
    }).length;
    $('dash-published-week').textContent = '本周 ' + weekPublished + ' 条';

    var totalViews = data.reduce(function(s, d) { return s + (Number(d.views) || 0); }, 0);
    $('dash-total-views').textContent = fmtNum(totalViews);

    var avgEng = data.length > 0
      ? data.reduce(function(s, d) { return s + getEngagementRate(d); }, 0) / data.length
      : 0;
    $('dash-avg-engagement').textContent = (avgEng * 100).toFixed(1) + '%';

    // 最佳平台
    var platformStats = {};
    data.forEach(function(d) {
      if (!platformStats[d.platform]) platformStats[d.platform] = { views: 0, eng: 0, count: 0 };
      platformStats[d.platform].views += Number(d.views) || 0;
      platformStats[d.platform].eng += getEngagementRate(d);
      platformStats[d.platform].count++;
    });
    var bestPlatform = '—';
    var bestEng = 0;
    Object.keys(platformStats).forEach(function(p) {
      var avg = platformStats[p].eng / platformStats[p].count;
      if (avg > bestEng) { bestEng = avg; bestPlatform = p; }
    });
    $('dash-best-platform').textContent = bestPlatform !== '—' ? '最佳：' + bestPlatform : '—';

    // 首页数据可视化在 charts.js 就绪后渲染
    if (typeof window.renderDashCharts === 'function') {
      window.renderDashCharts(data, topics);
    }

    // Badge
    $('badge-topics').textContent = topics.length;
    $('badge-inbox').textContent = DB.inboxItems.filter(function(i) { return i.status === 'unread'; }).length;
  }

  // ========== 数据邮箱 ==========
  var INBOX_CATEGORY_CONFIG = {
    '热点话题': { icon: '🔥', color: 'var(--red)' },
    '行业动态': { icon: '📰', color: 'var(--accent)' },
    '竞品内容': { icon: '👀', color: 'var(--accent2)' },
    '平台政策': { icon: '⚙️', color: 'var(--yellow)' },
    'AI工具': { icon: '🤖', color: 'var(--green)' }
  };

  function renderInbox() {
    var items = DB.inboxItems.slice();
    var fCat = $('inboxFilterCategory').value;
    var fStatus = $('inboxFilterStatus').value;

    if (fCat) items = items.filter(function(i) { return i.category === fCat; });
    if (fStatus) items = items.filter(function(i) { return i.status === fStatus; });

    // 按时间倒序
    items.sort(function(a, b) { return new Date(b.collectedAt || 0) - new Date(a.collectedAt || 0); });

    var wrap = $('inboxList');
    if (items.length === 0) {
      wrap.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">📬</div><div class="empty-text">邮箱空空如也<br><span style="font-size:12px;">运行 hotscan.py 自动收集，或点击「手动添加」</span></div></div></div>';
      return;
    }

    var html = '';
    items.forEach(function(item) {
      var config = INBOX_CATEGORY_CONFIG[item.category] || { icon: '📌', color: 'var(--muted)' };
      var statusBadge = '';
      if (item.status === 'unread') statusBadge = '<span class="tag tag-accent2">未读</span>';
      else if (item.status === 'starred') statusBadge = '<span class="tag tag-yellow">⭐ 已收藏</span>';
      else if (item.status === 'converted') statusBadge = '<span class="tag tag-green">✓ 已转选题</span>';
      else if (item.status === 'archived') statusBadge = '<span class="tag tag-muted">已归档</span>';

      var heatStr = item.heat ? '<span style="font-size:11px;color:var(--muted);">🔥 ' + fmtNum(item.heat) + '</span>' : '';
      var dateStr = item.collectedAt ? new Date(item.collectedAt).toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';

      html += '<div class="card" style="padding:16px;margin-bottom:10px;' + (item.status === 'unread' ? 'border-left:3px solid var(--accent2);' : '') + '">' +
        '<div style="display:flex;align-items:flex-start;gap:12px;">' +
          // 左：分类图标
          '<div style="flex-shrink:0;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;background:' + config.color + '15;">' + config.icon + '</div>' +
          // 中：内容
          '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">' +
              '<span style="font-weight:700;font-size:14px;">' + (item.title || '—') + '</span>' +
              '<span class="tag tag-muted" style="font-size:10px;">' + (item.category || '未分类') + '</span>' +
              statusBadge +
              heatStr +
            '</div>';

      if (item.summary) {
        html += '<div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:8px;">' + item.summary + '</div>';
      }

      html += '<div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--muted);">' +
        (item.source ? '<span>📍 ' + item.source + '</span>' : '') +
        (dateStr ? '<span>🕐 ' + dateStr + '</span>' : '') +
        (item.suggestForm ? '<span>💡 建议：' + item.suggestForm + '</span>' : '') +
      '</div>';

      if (item.url) {
        html += '<a href="' + item.url + '" target="_blank" style="display:inline-block;font-size:11px;color:var(--accent);margin-top:6px;">查看原文 ↗</a>';
      }

      html += '</div>' +
          // 右：操作按钮
          '<div style="flex-shrink:0;display:flex;flex-direction:column;gap:4px;">' +
            '<button class="btn btn-primary btn-sm" onclick="convertInboxToTopic(\'' + item.id + '\')" title="转为选题"' +
              (item.status === 'converted' ? ' disabled style="opacity:0.5;"' : '') + '>➕ 选题</button>' +
            '<button class="btn btn-sm" onclick="toggleInboxStar(\'' + item.id + '\')" title="收藏">' + (item.status === 'starred' ? '⭐' : '☆') + '</button>' +
            '<button class="btn btn-sm btn-danger" onclick="archiveInboxItem(\'' + item.id + '\')" title="归档">📦</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    });

    wrap.innerHTML = html;

    // 更新 badge
    var unread = DB.inboxItems.filter(function(i) { return i.status === 'unread'; }).length;
    $('badge-inbox').textContent = unread;
  }

  function openInboxAddModal() {
    $('inbox-item-id').value = '';
    $('inbox-title').value = '';
    $('inbox-category').value = '热点话题';
    $('inbox-source').value = '';
    $('inbox-heat').value = '';
    $('inbox-suggest-form').value = '短视频';
    $('inbox-summary').value = '';
    $('inbox-url').value = '';
    $('inboxAddModal').classList.add('show');
  }

  function saveInboxItem() {
    var title = $('inbox-title').value.trim();
    if (!title) { showToast('请输入标题'); return; }
    var item = {
      id: DB.genId(),
      title: title,
      category: $('inbox-category').value,
      source: $('inbox-source').value.trim(),
      heat: parseInt($('inbox-heat').value) || 0,
      suggestForm: $('inbox-suggest-form').value,
      summary: $('inbox-summary').value.trim(),
      url: $('inbox-url').value.trim(),
      status: 'unread',
      collectedAt: new Date().toISOString()
    };
    DB.inboxItems.unshift(item);
    DB.save('inbox');
    showToast('已添加到数据邮箱');
    closeModal('inboxAddModal');
    renderInbox();
  }

  function convertInboxToTopic(id) {
    var item = DB.inboxItems.find(function(i) { return i.id === id; });
    if (!item) return;

    // 填充确认弹框
    $('convert-item-id').value = id;
    $('convert-title').value = item.title || '';
    $('convert-form').value = item.suggestForm || '深度图文';
    $('convert-status').value = '灵感';
    $('convert-note').value = item.summary ? item.summary.slice(0, 80) : '';

    // 预览信息
    var config = INBOX_CATEGORY_CONFIG[item.category] || { icon: '📌', color: 'var(--muted)' };
    var preview = config.icon + ' <strong>' + (item.title || '') + '</strong><br>' +
      '<span style="color:var(--muted);font-size:12px;">分类：' + (item.category || '未分类') +
      ' · 来源：' + (item.source || '—') +
      (item.heat ? ' · 热度：' + fmtNum(item.heat) : '') + '</span>';
    if (item.summary) {
      preview += '<br><span style="color:var(--muted);font-size:12px;margin-top:4px;display:block;">' + item.summary + '</span>';
    }
    $('convertPreview').innerHTML = preview;

    // 生成平台选择按钮
    var platforms = ['B站', 'YouTube', '公众号', '抖音', '视频号', '小红书', '微博', '知乎'];
    var platHtml = '';
    platforms.forEach(function(p) {
      platHtml += '<label style="display:flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--rule);border-radius:8px;cursor:pointer;font-size:13px;transition:all 0.2s;" ' +
        'onmouseover="this.style.borderColor=\'var(--accent)\';this.style.color=\'var(--accent)\'" ' +
        'onmouseout="if(!this.querySelector(\'input\').checked){this.style.borderColor=\'var(--rule)\';this.style.color=\'\'}">' +
        '<input type="checkbox" value="' + p + '" style="accent-color:var(--accent);"> ' + p +
        '</label>';
    });
    $('convertPlatforms').innerHTML = platHtml;

    $('convertModal').classList.add('show');
  }

  function confirmConvert() {
    var id = $('convert-item-id').value;
    var item = DB.inboxItems.find(function(i) { return i.id === id; });
    if (!item) return;

    // 获取选中的平台
    var checked = document.querySelectorAll('#convertPlatforms input:checked');
    var platforms = [];
    checked.forEach(function(c) { platforms.push(c.value); });
    if (platforms.length === 0) {
      showToast('请至少选择一个目标平台');
      return;
    }

    // 添加到选题库
    DB.addTopic({
      title: $('convert-title').value.trim() || item.title,
      source: item.source || '数据邮箱',
      form: $('convert-form').value,
      traffic: item.heat > 10000 ? 5 : item.heat > 1000 ? 4 : 3,
      difficulty: 3, match: 3,
      platforms: platforms.join('/'),
      status: $('convert-status').value,
      note: $('convert-note').value.trim()
    });

    // 标记为已转选题
    item.status = 'converted';
    DB.save('inbox');

    showToast('已转为选题：' + ($('convert-title').value.trim() || item.title));
    closeModal('convertModal');
    renderInbox();
    updateBadge();
  }

  function toggleInboxStar(id) {
    var item = DB.inboxItems.find(function(i) { return i.id === id; });
    if (!item) return;
    item.status = item.status === 'starred' ? 'unread' : 'starred';
    DB.save('inbox');
    renderInbox();
  }

  function archiveInboxItem(id) {
    var item = DB.inboxItems.find(function(i) { return i.id === id; });
    if (!item) return;

    // 二次确认
    if (item._confirmArchive) {
      item.status = 'archived';
      delete item._confirmArchive;
      DB.save('inbox');
      showToast('已归档');
      renderInbox();
    } else {
      item._confirmArchive = true;
      DB.save('inbox');
      showToast('再点一次确认归档');
      setTimeout(function() {
        var i = DB.inboxItems.find(function(x) { return x.id === id; });
        if (i) { delete i._confirmArchive; DB.save('inbox'); }
      }, 5000);
    }
  }

  function markAllRead() {
    DB.inboxItems.forEach(function(i) {
      if (i.status === 'unread') i.status = 'read';
    });
    DB.save('inbox');
    showToast('已全部标记为已读');
    renderInbox();
  }

  // ========== 选题看板 ==========
  function renderTopics() {
    var filter = $('topicFilter') ? $('topicFilter').value : '';
    var topics = DB.topics;
    if (filter) {
      topics = topics.filter(function(t) { return t.status === filter; });
    }

    var wrap = $('topicsTableWrap');
    if (topics.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">💡</div><div class="empty-text">' +
        (filter ? '该状态下暂无选题' : '还没有选题，点击「新选题」开始记录灵感') + '</div></div>';
      return;
    }

    var html = '<div class="table-wrap"><table><thead><tr>' +
      '<th>标题</th><th>来源</th><th>流量</th><th>难度</th><th>匹配</th><th>总分</th>' +
      '<th>形式</th><th>平台</th><th>状态</th><th>操作</th>' +
      '</tr></thead><tbody>';

    topics.forEach(function(t) {
      var score = (t.traffic || 0) * (t.difficulty || 0) * (t.match || 0);
      var statusOpts = ['灵感', '待评估', '已排期', '创作中', '已发布'];
      var statusHtml = '<select class="form-select" style="font-size:11px;padding:2px 6px;width:auto;" onchange="updateTopicStatus(\'' + t.id + '\', this.value)">';
      statusOpts.forEach(function(s) {
        statusHtml += '<option value="' + s + '"' + (s === t.status ? ' selected' : '') + '>' + s + '</option>';
      });
      statusHtml += '</select>';

      html += '<tr>' +
        '<td style="font-weight:600;max-width:200px;">' + (t.title || '') + '</td>' +
        '<td style="color:var(--muted);font-size:12px;">' + (t.source || '—') + '</td>' +
        '<td>' + (t.traffic || '—') + '</td>' +
        '<td>' + (t.difficulty || '—') + '</td>' +
        '<td>' + (t.match || '—') + '</td>' +
        '<td>' + scoreTag(score) + '</td>' +
        '<td><span class="tag tag-accent">' + (t.form || '—') + '</span></td>' +
        '<td style="font-size:12px;">' + (t.platforms || '—') + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn btn-sm" onclick="editTopic(\'' + t.id + '\')">✏</button> ' +
          '<button class="btn btn-sm btn-danger" id="del-btn-' + t.id + '" onclick="deleteTopicConfirm(\'' + t.id + '\')">🗑</button>' +
        '</td>' +
        '</tr>';
    });

    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  // ========== 内容看板 ==========
  var BOARD_PLATFORMS = ['B站', 'YouTube', '公众号', '抖音', '视频号', '小红书'];

  function calcTotalScore(t) {
    var tr = t.traffic || 3, df = t.difficulty || 3, mt = t.match || 3;
    var tm = t.timeliness || 3, mn = t.monetization || 3, rs = t.reuse || 3;
    return tr * df * mt; // 基础三维总分
  }

  function calcFullScore(t) {
    var tr = t.traffic || 3, df = t.difficulty || 3, mt = t.match || 3;
    var tm = t.timeliness || 3, mn = t.monetization || 3, rs = t.reuse || 3;
    // 六维加权：三维基础 × (时效+商业+复用) 的平均值修正
    var base = tr * df * mt;
    var bonus = ((tm + mn + rs) / 15); // 0.2~1.0
    return Math.round(base * (0.6 + bonus * 0.4));
  }

  function calcGrade(score) {
    if (score >= 80) return 'S';
    if (score >= 60) return 'A';
    if (score >= 40) return 'B';
    return 'C';
  }

  var gradeColors = { S: 'var(--red)', A: 'var(--accent)', B: 'var(--yellow)', C: 'var(--muted)' };
  var gradeLabels = { S: 'S 级 · 优先', A: 'A 级 · 重点', B: 'B 级 · 常规', C: 'C 级 · 备选' };

  function renderBoard() {
    var topics = DB.topics.slice();

    // 筛选
    var fGrade = $('boardFilterGrade').value;
    var fStatus = $('boardFilterStatus').value;
    var fForm = $('boardFilterForm').value;
    var sortBy = $('boardSort').value;

    // 计算分数和分级
    topics.forEach(function(t) {
      t._score = calcFullScore(t);
      t._grade = calcGrade(t._score);
    });

    if (fGrade) topics = topics.filter(function(t) { return t._grade === fGrade; });
    if (fStatus) topics = topics.filter(function(t) { return t.status === fStatus; });
    if (fForm) topics = topics.filter(function(t) { return t.form === fForm; });

    // 排序
    if (sortBy === 'score') topics.sort(function(a, b) { return b._score - a._score; });
    if (sortBy === 'grade') topics.sort(function(a, b) {
      var order = { S: 0, A: 1, B: 2, C: 3 };
      return order[a._grade] - order[b._grade];
    });
    if (sortBy === 'time') topics.sort(function(a, b) {
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    if (sortBy === 'title') topics.sort(function(a, b) {
      return (a.title || '').localeCompare(b.title || '');
    });

    // 分级统计
    var allTopics = DB.topics;
    var gradeStats = { S: 0, A: 0, B: 0, C: 0 };
    allTopics.forEach(function(t) {
      var s = calcFullScore(t);
      var g = calcGrade(s);
      gradeStats[g]++;
    });
    var statsHtml = '';
    ['S', 'A', 'B', 'C'].forEach(function(g) {
      statsHtml += '<div class="stat-card" style="padding:16px;">' +
        '<div class="stat-value" style="font-size:24px;color:' + gradeColors[g] + ';">' + gradeStats[g] + '</div>' +
        '<div class="stat-label" style="margin-top:2px;">' + gradeLabels[g] + '</div>' +
        '</div>';
    });
    $('boardGradeStats').innerHTML = statsHtml;

    // 卡片列表
    var wrap = $('boardList');
    if (topics.length === 0) {
      wrap.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">🎯</div><div class="empty-text">暂无符合条件的内容</div></div></div>';
      return;
    }

    var html = '';
    topics.forEach(function(t) {
      var score = t._score;
      var grade = t._grade;
      var proc = t.processing || {};
      var procStatus = proc.status || 'none';
      var adaptations = proc.adaptations || [];

      // 加工进度
      var doneCount = adaptations.filter(function(a) { return a.status === 'done'; }).length;
      var procProgress = adaptations.length > 0 ? Math.round(doneCount / adaptations.length * 100) : 0;

      // 迷你六维条
      var dims = [
        { label: '流量', val: t.traffic || 3 },
        { label: '难度', val: t.difficulty || 3 },
        { label: '匹配', val: t.match || 3 },
        { label: '时效', val: t.timeliness || 3 },
        { label: '商业', val: t.monetization || 3 },
        { label: '复用', val: t.reuse || 3 }
      ];
      var dimHtml = '';
      dims.forEach(function(d) {
        var pct = (d.val / 5) * 100;
        var c = d.val >= 4 ? gradeColors.S : d.val >= 3 ? gradeColors.A : gradeColors.C;
        dimHtml += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">' +
          '<span style="font-size:10px;color:var(--muted);width:28px;flex-shrink:0;">' + d.label + '</span>' +
          '<div style="flex:1;height:5px;background:var(--rule);border-radius:3px;overflow:hidden;">' +
          '<div style="height:100%;width:' + pct + '%;background:' + c + ';border-radius:3px;"></div></div>' +
          '<span style="font-size:10px;color:var(--muted);width:8px;">' + d.val + '</span>' +
          '</div>';
      });

      // 平台适配标签
      var platformTags = '';
      if (adaptations.length > 0) {
        adaptations.forEach(function(a) {
          var tagClass = a.status === 'done' ? 'tag-green' : a.status === 'processing' ? 'tag-yellow' : 'tag-muted';
          platformTags += '<span class="tag ' + tagClass + '" style="font-size:10px;">' + a.platform + (a.status === 'done' ? '✓' : a.status === 'processing' ? '…' : '') + '</span> ';
        });
      }

      var procBadge = procStatus === 'done' ? '<span class="tag tag-green">加工完成</span>'
        : procStatus === 'processing' ? '<span class="tag tag-yellow">加工中</span>'
        : '<span class="tag tag-muted">未加工</span>';

      html += '<div class="card" style="padding:16px;margin-bottom:12px;">' +
        '<div style="display:flex;align-items:flex-start;gap:12px;">' +
          // 左侧：分级徽章
          '<div style="flex-shrink:0;width:42px;height:42px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;color:#fff;background:' + gradeColors[grade] + ';">' + grade + '</div>' +
          // 中间：内容信息
          '<div style="flex:1;min-width:0;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
              '<span style="font-weight:700;font-size:14px;">' + (t.title || '—') + '</span>' +
              '<span class="tag tag-accent">' + (t.form || '—') + '</span>' +
              '<span class="status-' + (t.status || '灵感') + '">' + (t.status || '灵感') + '</span>' +
              procBadge +
            '</div>' +
            '<div style="display:flex;gap:16px;align-items:flex-start;">' +
              '<div style="flex:1;max-width:240px;">' + dimHtml + '</div>' +
              '<div style="flex:1;">' +
                '<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">综合评分</div>' +
                '<div style="font-size:22px;font-weight:800;color:' + gradeColors[grade] + ';">' + score + '</div>' +
                (platformTags ? '<div style="margin-top:6px;">' + platformTags + '</div>' : '') +
                (procProgress > 0 ? '<div style="margin-top:6px;"><div class="progress-bar"><div class="progress-fill" style="width:' + procProgress + '%;"></div></div><div style="font-size:10px;color:var(--muted);margin-top:2px;">适配进度 ' + procProgress + '% (' + doneCount + '/' + adaptations.length + ')</div></div>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          // 右侧：操作
          '<div style="flex-shrink:0;display:flex;flex-direction:column;gap:4px;">' +
            '<button class="btn btn-sm" onclick="openScoreModal(\'' + t.id + '\')">📐</button>' +
            '<button class="btn btn-sm" onclick="openProcessModal(\'' + t.id + '\')">🔧</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    });

    wrap.innerHTML = html;
  }

  // ========== 多维评分弹窗 ==========
  function openScoreModal(topicId) {
    var modal = $('scoreModal');
    var select = $('score-topic-id');

    // 填充选题下拉
    select.innerHTML = '<option value="">— 选择选题 —</option>';
    DB.topics.forEach(function(t) {
      select.innerHTML += '<option value="' + t.id + '">' + (t.title || '无标题') + '</option>';
    });

    if (topicId) select.value = topicId;
    loadScoreData();
    modal.classList.add('show');
  }

  function loadScoreData() {
    var id = $('score-topic-id').value;
    if (!id) { $('scoreFields').style.display = 'none'; return; }
    var t = DB.topics.find(function(x) { return x.id === id; });
    if (!t) return;
    $('scoreFields').style.display = '';
    $('score-traffic').value = t.traffic || 3;
    $('score-difficulty').value = t.difficulty || 3;
    $('score-match').value = t.match || 3;
    $('score-timeliness').value = t.timeliness || 3;
    $('score-monetization').value = t.monetization || 3;
    $('score-reuse').value = t.reuse || 3;
    updateScoreTotal();
  }

  function updateScoreTotal() {
    var t = {
      traffic: parseInt($('score-traffic').value) || 3,
      difficulty: parseInt($('score-difficulty').value) || 3,
      match: parseInt($('score-match').value) || 3,
      timeliness: parseInt($('score-timeliness').value) || 3,
      monetization: parseInt($('score-monetization').value) || 3,
      reuse: parseInt($('score-reuse').value) || 3
    };
    var score = calcFullScore(t);
    var grade = calcGrade(score);
    $('scoreTotalVal').textContent = score;
    $('scoreTotalVal').style.color = gradeColors[grade];
    $('scoreGradeVal').textContent = gradeLabels[grade];
    $('scoreGradeVal').style.color = gradeColors[grade];
  }

  function saveScore() {
    var id = $('score-topic-id').value;
    if (!id) { showToast('请选择内容'); return; }
    DB.updateTopic(id, {
      traffic: parseInt($('score-traffic').value) || 3,
      difficulty: parseInt($('score-difficulty').value) || 3,
      match: parseInt($('score-match').value) || 3,
      timeliness: parseInt($('score-timeliness').value) || 3,
      monetization: parseInt($('score-monetization').value) || 3,
      reuse: parseInt($('score-reuse').value) || 3
    });
    showToast('评分已保存');
    closeModal('scoreModal');
    renderBoard();
  }

  // ========== 二次加工弹窗 ==========
  function openProcessModal(topicId) {
    var modal = $('processModal');
    var select = $('proc-topic-id');

    select.innerHTML = '<option value="">— 选择选题 —</option>';
    DB.topics.forEach(function(t) {
      select.innerHTML += '<option value="' + t.id + '">' + (t.title || '无标题') + '</option>';
    });

    // 填充母内容下拉
    var parentSelect = $('proc-parent-id');
    parentSelect.innerHTML = '<option value="">— 选择母内容 —</option>';
    DB.topics.forEach(function(t) {
      var p = t.processing || {};
      if (p.role === 'parent' || !p.role) {
        parentSelect.innerHTML += '<option value="' + t.id + '">' + (t.title || '无标题') + '</option>';
      }
    });

    if (topicId) select.value = topicId;
    loadProcessData();
    modal.classList.add('show');
  }

  function loadProcessData() {
    var id = $('proc-topic-id').value;
    if (!id) { $('processFields').style.display = 'none'; return; }
    var t = DB.topics.find(function(x) { return x.id === id; });
    if (!t) return;

    $('processFields').style.display = '';
    var proc = t.processing || {};
    $('proc-role').value = proc.role || 'parent';
    $('proc-parent-id').value = proc.parentId || '';
    toggleParentGroup();

    var status = proc.status || 'none';
    document.querySelectorAll('input[name="proc-status"]').forEach(function(r) {
      r.checked = r.value === status;
    });

    $('proc-notes').value = proc.notes || '';

    // 平台适配清单
    var adaptations = proc.adaptations || [];
    var html = '';
    BOARD_PLATFORMS.forEach(function(p) {
      var existing = adaptations.find(function(a) { return a.platform === p; });
      var st = existing ? existing.status : 'none';
      html += '<div class="checklist-item" style="padding:4px 0;">' +
        '<select class="form-select" style="font-size:11px;width:auto;padding:2px 6px;" id="proc-plat-' + p + '">' +
        '<option value="none"' + (st === 'none' ? ' selected' : '') + '>⬜ ' + p + '</option>' +
        '<option value="processing"' + (st === 'processing' ? ' selected' : '') + '>🔄 ' + p + ' 进行中</option>' +
        '<option value="done"' + (st === 'done' ? ' selected' : '') + '>✅ ' + p + ' 已完成</option>' +
        '</select></div>';
    });
    $('procPlatforms').innerHTML = html;
  }

  function toggleParentGroup() {
    var role = $('proc-role').value;
    $('proc-parent-group').style.display = role === 'child' ? '' : 'none';
  }

  function saveProcess() {
    var id = $('proc-topic-id').value;
    if (!id) { showToast('请选择内容'); return; }

    var adaptations = [];
    BOARD_PLATFORMS.forEach(function(p) {
      var sel = $('proc-plat-' + p);
      if (sel && sel.value !== 'none') {
        adaptations.push({ platform: p, status: sel.value });
      }
    });

    var status = 'none';
    document.querySelectorAll('input[name="proc-status"]').forEach(function(r) {
      if (r.checked) status = r.value;
    });

    var processing = {
      role: $('proc-role').value,
      parentId: $('proc-role').value === 'child' ? $('proc-parent-id').value : null,
      status: status,
      adaptations: adaptations,
      notes: $('proc-notes').value.trim()
    };

    DB.updateTopic(id, { processing: processing });
    showToast('加工信息已保存');
    closeModal('processModal');
    renderBoard();
  }

  // 选题表单
  function openTopicModal(id) {
    var modal = $('topicModal');
    clearTopicForm();
    if (id) {
      var t = DB.topics.find(function(x) { return x.id === id; });
      if (t) {
        $('topic-id').value = t.id;
        $('topic-title').value = t.title || '';
        $('topic-source').value = t.source || '';
        $('topic-form').value = t.form || '深度图文';
        $('topic-traffic').value = t.traffic || 3;
        $('topic-difficulty').value = t.difficulty || 3;
        $('topic-match').value = t.match || 3;
        $('topic-platforms').value = t.platforms || '';
        $('topic-status').value = t.status || '灵感';
        $('topic-note').value = t.note || '';
        $('topicModal').querySelector('.modal-title').textContent = '编辑选题';
      }
    } else {
      $('topicModal').querySelector('.modal-title').textContent = '添加选题';
    }
    updateTopicScore();
    modal.classList.add('show');
  }

  function clearTopicForm() {
    $('topic-id').value = '';
    $('topic-title').value = '';
    $('topic-source').value = '';
    $('topic-form').value = '深度图文';
    $('topic-traffic').value = 3;
    $('topic-difficulty').value = 3;
    $('topic-match').value = 3;
    $('topic-platforms').value = '';
    $('topic-status').value = '灵感';
    $('topic-note').value = '';
  }

  function updateTopicScore() {
    var t = parseInt($('topic-traffic').value) || 0;
    var d = parseInt($('topic-difficulty').value) || 0;
    var m = parseInt($('topic-match').value) || 0;
    var score = t * d * m;
    $('topic-score').textContent = score;
    var hint = score >= 60 ? '⭐ 高优先级' : score >= 40 ? '中等优先级' : '低优先级';
    $('score-hint').textContent = hint;
  }

  function saveTopic() {
    var title = $('topic-title').value.trim();
    if (!title) { showToast('请输入选题标题'); return; }
    var id = $('topic-id').value;
    var data = {
      title: title,
      source: $('topic-source').value.trim(),
      form: $('topic-form').value,
      traffic: parseInt($('topic-traffic').value) || 3,
      difficulty: parseInt($('topic-difficulty').value) || 3,
      match: parseInt($('topic-match').value) || 3,
      platforms: $('topic-platforms').value.trim(),
      status: $('topic-status').value,
      note: $('topic-note').value.trim()
    };
    if (id) {
      DB.updateTopic(id, data);
      showToast('选题已更新');
    } else {
      DB.addTopic(data);
      showToast('选题已添加');
    }
    closeModal('topicModal');
    renderTopics();
    updateBadge();
  }

  // 二次点击确认状态记录
  var pendingDelete = {};

  function deleteTopicConfirm(id) {
    var btn = document.getElementById('del-btn-' + id);
    if (!btn) return;

    // 第一次点击：变为"确认"状态
    if (!pendingDelete[id]) {
      pendingDelete[id] = true;
      btn.textContent = '确认?';
      btn.style.background = 'var(--red)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--red)';
      // 5 秒后自动取消确认状态
      setTimeout(function() {
        if (pendingDelete[id]) {
          delete pendingDelete[id];
          if (btn) {
            btn.textContent = '🗑';
            btn.style.background = '';
            btn.style.color = '';
            btn.style.borderColor = '';
          }
        }
      }, 5000);
      return;
    }

    // 第二次点击：执行删除
    DB.deleteTopic(id);
    delete pendingDelete[id];
    showToast('已删除');
    renderTopics();
    updateBadge();
  }

  function updateTopicStatus(id, status) {
    DB.updateTopic(id, { status: status });
    showToast('状态已更新为：' + status);
  }

  function editTopic(id) { openTopicModal(id); }

  function updateBadge() {
    $('badge-topics').textContent = DB.topics.length;
  }

  // ========== 数据追踪 ==========
  function openDataModal() {
    var modal = $('dataModal');
    $('data-id').value = '';
    $('data-date').value = new Date().toISOString().slice(0, 10);
    $('data-platform').value = 'B站';
    $('data-title').value = '';
    $('data-views').value = '';
    $('data-likes').value = '';
    $('data-comments').value = '';
    $('data-shares').value = '';
    $('data-favorites').value = '';
    $('data-followers').value = '';
    $('data-note').value = '';
    modal.classList.add('show');
  }

  function saveData() {
    var title = $('data-title').value.trim();
    if (!title) { showToast('请输入内容标题'); return; }
    var d = {
      date: $('data-date').value,
      platform: $('data-platform').value,
      title: title,
      views: parseInt($('data-views').value) || 0,
      likes: parseInt($('data-likes').value) || 0,
      comments: parseInt($('data-comments').value) || 0,
      shares: parseInt($('data-shares').value) || 0,
      favorites: parseInt($('data-favorites').value) || 0,
      followers: parseInt($('data-followers').value) || 0,
      note: $('data-note').value.trim()
    };
    DB.addData(d);
    closeModal('dataModal');
    showToast('数据已记录');
    renderDataPage();
  }

  function deleteDataConfirm(id) {
    var btn = document.getElementById('del-data-' + id);
    if (!btn) return;

    if (!pendingDelete['data-' + id]) {
      pendingDelete['data-' + id] = true;
      btn.textContent = '确认?';
      btn.style.background = 'var(--red)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--red)';
      setTimeout(function() {
        if (pendingDelete['data-' + id]) {
          delete pendingDelete['data-' + id];
          if (btn) {
            btn.textContent = '🗑';
            btn.style.background = '';
            btn.style.color = '';
            btn.style.borderColor = '';
          }
        }
      }, 5000);
      return;
    }

    DB.deleteData(id);
    delete pendingDelete['data-' + id];
    showToast('已删除');
    renderDataPage();
  }

  // 平台配置
  var PLATFORM_CONFIG = {
    'B站':     { icon: '📺', color: '#fb7185', metrics: '播放', label: 'B站' },
    'YouTube': { icon: '▶️', color: '#ef4444', metrics: '观看', label: 'YouTube' },
    '公众号':  { icon: '📱', color: '#10b981', metrics: '阅读', label: '公众号' },
    '抖音':    { icon: '🎵', color: '#111827', metrics: '播放', label: '抖音' },
    '视频号':  { icon: '📹', color: '#6366f1', metrics: '播放', label: '视频号' },
    '小红书':  { icon: '📕', color: '#ec4899', metrics: '阅读', label: '小红书' },
    '微博':    { icon: '🐦', color: '#f59e0b', metrics: '阅读', label: '微博' },
    '知乎':    { icon: '📚', color: '#3b82f6', metrics: '阅读', label: '知乎' }
  };

  var activePlatformTab = null; // 当前选中的平台 Tab

  function renderDataPage() {
    var data = DB.dataRecords;

    // 1. 全部数据记录表
    var wrap = $('dataTableWrap');
    if (data.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">还没有数据，发布内容后点击「记数据」</div></div>';
    } else {
      var html = '<div class="table-wrap"><table><thead><tr>' +
        '<th>日期</th><th>标题</th><th>平台</th><th>播放</th><th>互动率</th><th>涨粉</th><th>操作</th>' +
        '</tr></thead><tbody>';
      data.forEach(function(d) {
        var eng = getEngagementRate(d);
        var engTag = eng >= 0.05 ? '<span class="tag tag-green">' + (eng * 100).toFixed(1) + '%</span>'
                   : eng >= 0.02 ? '<span class="tag tag-yellow">' + (eng * 100).toFixed(1) + '%</span>'
                   : '<span class="tag tag-muted">' + (eng * 100).toFixed(1) + '%</span>';
        html += '<tr>' +
          '<td style="font-size:12px;">' + (d.date || '—') + '</td>' +
          '<td style="font-weight:600;max-width:200px;">' + (d.title || '') + '</td>' +
          '<td><span class="tag tag-accent2">' + (d.platform || '—') + '</span></td>' +
          '<td>' + fmtNum(d.views) + '</td>' +
          '<td>' + engTag + '</td>' +
          '<td>' + (d.followers || 0) + '</td>' +
          '<td><button class="btn btn-sm btn-danger" id="del-data-' + d.id + '" onclick="deleteDataConfirm(\'' + d.id + '\')">🗑</button></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      wrap.innerHTML = html;
    }

    // 2. 平台概览卡片
    renderPlatformOverview(data);

    // 3. 平台 Tab
    renderPlatformTabs(data);

    // 4. 默认选中第一个有数据的平台
    if (activePlatformTab && data.some(function(d) { return d.platform === activePlatformTab; })) {
      renderPlatformDetail(activePlatformTab, data);
    } else {
      var platformsWithData = getPlatformsWithData(data);
      if (platformsWithData.length > 0) {
        activePlatformTab = platformsWithData[0];
        renderPlatformDetail(activePlatformTab, data);
      } else {
        $('platformDetail').innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">暂无数据，先记录一些数据吧</div></div>';
      }
    }

    // 5. 全局图表
    if (typeof renderDataCharts === 'function') {
      renderDataCharts(data);
    }
  }

  function getPlatformsWithData(data) {
    var seen = {};
    var result = [];
    data.forEach(function(d) {
      if (!seen[d.platform]) { seen[d.platform] = true; result.push(d.platform); }
    });
    // 按预定义顺序排
    var order = ['B站','YouTube','公众号','抖音','视频号','小红书','微博','知乎'];
    result.sort(function(a, b) { return order.indexOf(a) - order.indexOf(b); });
    return result;
  }

  function renderPlatformOverview(data) {
    var platforms = getPlatformsWithData(data);
    if (platforms.length === 0) {
      $('platformOverview').innerHTML = '';
      return;
    }

    var cards = '';
    platforms.forEach(function(p) {
      var pData = data.filter(function(d) { return d.platform === p; });
      var config = PLATFORM_CONFIG[p] || { icon: '📱', color: 'var(--accent)', metrics: '播放', label: p };
      var totalViews = pData.reduce(function(s, d) { return s + (Number(d.views) || 0); }, 0);
      var totalLikes = pData.reduce(function(s, d) { return s + (Number(d.likes) || 0); }, 0);
      var totalFollowers = pData.reduce(function(s, d) { return s + (Number(d.followers) || 0); }, 0);
      var avgEng = pData.reduce(function(s, d) { return s + getEngagementRate(d); }, 0) / pData.length;

      // 趋势：最近 vs 前一条
      var sorted = pData.slice().sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
      var trend = '';
      var trendColor = 'var(--muted)';
      if (sorted.length >= 2) {
        var last = sorted[sorted.length - 1];
        var prev = sorted[sorted.length - 2];
        if (last.views && prev.views) {
          var change = ((last.views - prev.views) / prev.views * 100);
          if (change > 5) { trend = '↑ ' + change.toFixed(0) + '%'; trendColor = 'var(--green)'; }
          else if (change < -5) { trend = '↓ ' + Math.abs(change).toFixed(0) + '%'; trendColor = 'var(--red)'; }
          else { trend = '→ 持平'; trendColor = 'var(--muted)'; }
        }
      }

      cards += '<div class="stat-card" style="cursor:pointer;" onclick="switchPlatformTab(\'' + p + '\')">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
          '<span style="font-size:18px;">' + config.icon + '</span>' +
          '<span style="font-weight:700;font-size:13px;">' + config.label + '</span>' +
          '<span style="margin-left:auto;font-size:11px;font-weight:600;color:' + trendColor + ';">' + trend + '</span>' +
        '</div>' +
        '<div style="font-size:22px;font-weight:800;color:' + config.color + ';">' + fmtNum(totalViews) + '</div>' +
        '<div style="font-size:11px;color:var(--muted);">总' + config.metrics + ' · ' + pData.length + ' 条</div>' +
        '<div style="display:flex;gap:12px;margin-top:8px;font-size:11px;color:var(--muted);">' +
          '<span>👍 ' + fmtNum(totalLikes) + '</span>' +
          '<span>👥 ' + totalFollowers + '</span>' +
          '<span>📊 ' + (avgEng * 100).toFixed(1) + '%</span>' +
        '</div>' +
      '</div>';
    });

    $('platformOverview').innerHTML = '<div class="stat-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));margin-bottom:20px;">' + cards + '</div>';
  }

  function renderPlatformTabs(data) {
    var platforms = getPlatformsWithData(data);
    if (platforms.length === 0) {
      $('platformTabs').innerHTML = '';
      return;
    }

    var html = '';
    platforms.forEach(function(p) {
      var config = PLATFORM_CONFIG[p] || { icon: '📱', label: p };
      var isActive = p === activePlatformTab;
      var count = data.filter(function(d) { return d.platform === p; }).length;
      html += '<div onclick="switchPlatformTab(\'' + p + '\')" style="' +
        'padding:10px 16px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;' +
        'border-bottom:' + (isActive ? '3px solid var(--accent)' : '3px solid transparent') + ';' +
        'color:' + (isActive ? 'var(--accent)' : 'var(--muted)') + ';' +
        'background:' + (isActive ? 'var(--bg2)' : 'transparent') + ';"' +
        '>' + config.icon + ' ' + config.label + ' <span style="font-size:11px;opacity:0.7;">(' + count + ')</span></div>';
    });
    $('platformTabs').innerHTML = html;
  }

  function switchPlatformTab(platform) {
    activePlatformTab = platform;
    renderPlatformTabs(DB.dataRecords);
    renderPlatformDetail(platform, DB.dataRecords);
  }

  function renderPlatformDetail(platform, data) {
    var pData = data.filter(function(d) { return d.platform === platform; });
    var config = PLATFORM_CONFIG[platform] || { icon: '📱', color: 'var(--accent)', metrics: '播放', label: platform };

    if (pData.length === 0) {
      $('platformDetail').innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">该平台暂无数据</div></div>';
      return;
    }

    // 按日期排序
    var sorted = pData.slice().sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

    // 统计
    var totalViews = sorted.reduce(function(s, d) { return s + (Number(d.views) || 0); }, 0);
    var totalLikes = sorted.reduce(function(s, d) { return s + (Number(d.likes) || 0); }, 0);
    var totalComments = sorted.reduce(function(s, d) { return s + (Number(d.comments) || 0); }, 0);
    var totalShares = sorted.reduce(function(s, d) { return s + (Number(d.shares) || 0); }, 0);
    var totalFavs = sorted.reduce(function(s, d) { return s + (Number(d.favorites) || 0); }, 0);
    var totalFollowers = sorted.reduce(function(s, d) { return s + (Number(d.followers) || 0); }, 0);
    var avgEng = sorted.reduce(function(s, d) { return s + getEngagementRate(d); }, 0) / sorted.length;
    var bestPost = sorted.slice().sort(function(a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); })[0];

    // 排行表（按播放/阅读降序）
    var ranked = pData.slice().sort(function(a, b) { return (Number(b.views) || 0) - (Number(a.views) || 0); });
    var rankHtml = '<div class="table-wrap" style="margin-top:16px;"><table><thead><tr>' +
      '<th>排名</th><th>标题</th><th>日期</th><th>' + config.metrics + '</th><th>互动率</th><th>涨粉</th>' +
      '</tr></thead><tbody>';
    ranked.forEach(function(d, i) {
      var eng = getEngagementRate(d);
      var engTag = eng >= 0.05 ? '<span class="tag tag-green">' + (eng * 100).toFixed(1) + '%</span>'
                 : eng >= 0.02 ? '<span class="tag tag-yellow">' + (eng * 100).toFixed(1) + '%</span>'
                 : '<span class="tag tag-muted">' + (eng * 100).toFixed(1) + '%</span>';
      var rankBadge = i === 0 ? '<span style="font-size:16px;">🥇</span>'
                    : i === 1 ? '<span style="font-size:16px;">🥈</span>'
                    : i === 2 ? '<span style="font-size:16px;">🥉</span>'
                    : '<span style="color:var(--muted);font-size:12px;">' + (i + 1) + '</span>';
      rankHtml += '<tr>' +
        '<td style="text-align:center;">' + rankBadge + '</td>' +
        '<td style="font-weight:600;max-width:220px;">' + (d.title || '') + '</td>' +
        '<td style="font-size:12px;">' + (d.date || '—') + '</td>' +
        '<td style="font-weight:700;">' + fmtNum(d.views) + '</td>' +
        '<td>' + engTag + '</td>' +
        '<td>' + (d.followers || 0) + '</td>' +
        '</tr>';
    });
    rankHtml += '</tbody></table></div>';

    // 详情 HTML
    var html = '' +
      // 平台标题
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">' +
        '<span style="font-size:22px;">' + config.icon + '</span>' +
        '<span style="font-size:18px;font-weight:800;">' + config.label + '</span>' +
        '<span style="font-size:12px;color:var(--muted);margin-left:4px;">' + sorted.length + ' 条数据</span>' +
      '</div>' +

      // 四个关键指标
      '<div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px;">' +
        '<div style="text-align:center;padding:12px;background:var(--bg);border-radius:8px;">' +
          '<div style="font-size:20px;font-weight:800;color:' + config.color + ';">' + fmtNum(totalViews) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);">总' + config.metrics + '</div></div>' +
        '<div style="text-align:center;padding:12px;background:var(--bg);border-radius:8px;">' +
          '<div style="font-size:20px;font-weight:800;color:var(--accent2);">' + (avgEng * 100).toFixed(1) + '%</div>' +
          '<div style="font-size:11px;color:var(--muted);">平均互动率</div></div>' +
        '<div style="text-align:center;padding:12px;background:var(--bg);border-radius:8px;">' +
          '<div style="font-size:20px;font-weight:800;color:var(--accent);">' + totalFollowers + '</div>' +
          '<div style="font-size:11px;color:var(--muted);">总涨粉</div></div>' +
        '<div style="text-align:center;padding:12px;background:var(--bg);border-radius:8px;">' +
          '<div style="font-size:20px;font-weight:800;color:var(--green);">' + fmtNum(totalLikes + totalComments + totalShares + totalFavs) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);">总互动</div></div>' +
      '</div>' +

      // 趋势图容器
      '<div class="card" style="margin-bottom:16px;">' +
        '<div class="card-header"><div class="card-title">📈 ' + config.label + '数据趋势</div></div>' +
        '<div id="chart-platform-detail" style="width:100%;min-height:300px;"></div>' +
      '</div>' +

      // 最佳内容
      (bestPost ? '<div style="background:linear-gradient(135deg,var(--accent-soft),var(--accent2-soft));border-radius:8px;padding:12px 16px;margin-bottom:16px;">' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:4px;">🏆 最佳内容</div>' +
        '<div style="font-weight:700;font-size:14px;">' + (bestPost.title || '—') + '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-top:4px;">' + fmtNum(bestPost.views) + ' ' + config.metrics + ' · ' +
          (bestPost.likes || 0) + ' 赞 · ' + (bestPost.followers || 0) + ' 涨粉 · ' + (bestPost.date || '') + '</div>' +
      '</div>' : '') +

      // 排行表
      '<div style="font-size:14px;font-weight:700;margin-bottom:8px;">🏅 内容排行（按' + config.metrics + '）</div>' +
      rankHtml;

    $('platformDetail').innerHTML = html;

    // 渲染该平台的趋势图
    if (typeof renderPlatformChart === 'function') {
      renderPlatformChart('chart-platform-detail', sorted, config);
    }
  }

  // ========== 周复盘 ==========
  function renderReviewPage() {
    // ===== 日复盘初始化 =====
    var today = new Date().toISOString().slice(0, 10);
    $('daily-date').value = today;
    loadDailyReview();
    renderDailyHistory();

    // ===== 周复盘 =====
    $('reviewWeekLabel').textContent = getWeekLabel();

    // 尝试加载本周已存的复盘
    var week = getWeekLabel();
    var existing = DB.reviews.find(function(r) { return r.week === week; });
    if (existing) {
      $('review-best').value = existing.best || '';
      $('review-worst').value = existing.worst || '';
      $('review-platform').value = existing.platform || '';
      $('review-do-more').value = existing.doMore || '';
      $('review-do-less').value = existing.doLess || '';
      $('review-next-topics').value = existing.nextTopics || '';
    }

    // 历史
    if (DB.reviews.length > 0) {
      $('reviewHistoryCard').style.display = '';
      var html = '';
      DB.reviews.forEach(function(r) {
        html += '<div class="card" style="margin-bottom:12px;padding:16px;">';
        html += '<div style="font-weight:700;margin-bottom:8px;">' + (r.week || '') + '</div>';
        if (r.best) html += '<div style="font-size:13px;margin-bottom:6px;"><strong>✅ 最佳：</strong>' + r.best.slice(0, 100) + '...</div>';
        if (r.doMore) html += '<div style="font-size:13px;margin-bottom:6px;"><strong>⬆ 放大：</strong>' + r.doMore.slice(0, 100) + '...</div>';
        if (r.doLess) html += '<div style="font-size:13px;"><strong>⬇ 停止：</strong>' + r.doLess.slice(0, 100) + '...</div>';
        html += '</div>';
      });
      $('reviewHistory').innerHTML = html;
    }
  }

  function saveReview() {
    var week = getWeekLabel();
    var existing = DB.reviews.find(function(r) { return r.week === week; });
    var data = {
      week: week,
      best: $('review-best').value.trim(),
      worst: $('review-worst').value.trim(),
      platform: $('review-platform').value.trim(),
      doMore: $('review-do-more').value.trim(),
      doLess: $('review-do-less').value.trim(),
      nextTopics: $('review-next-topics').value.trim()
    };
    if (existing) {
      Object.assign(existing, data);
      DB.save('reviews');
    } else {
      DB.addReview(data);
    }
    showToast('复盘已保存');
    renderReviewPage();
  }

  // ========== 日复盘 ==========
  function loadDailyReview() {
    var date = $('daily-date').value;
    if (!date) return;

    var existing = DB.dailyReviews.find(function(r) { return r.date === date; });

    // 更新标签
    var d = new Date(date);
    var wd = ['日','一','二','三','四','五','六'][d.getDay()];
    $('dailyDateLabel').textContent = date.slice(5) + ' 周' + wd + (existing ? ' · 已记录' : ' · 未记录');

    if (existing) {
      $('daily-mood').value = existing.mood || '';
      $('daily-done').value = existing.done || '';
      $('daily-highlight').value = existing.highlight || '';
      $('daily-reflect').value = existing.reflect || '';
      $('daily-tomorrow').value = existing.tomorrow || '';
    } else {
      $('daily-mood').value = '';
      $('daily-done').value = '';
      $('daily-highlight').value = '';
      $('daily-reflect').value = '';
      $('daily-tomorrow').value = '';
      // 如果有前一天的复盘，把前一天的"明日重点"填入今天的"完成"
      var prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);
      var prevDateStr = prevDate.toISOString().slice(0, 10);
      var prev = DB.dailyReviews.find(function(r) { return r.date === prevDateStr; });
      if (prev && prev.tomorrow) {
        $('daily-done').value = '（昨日计划）' + prev.tomorrow;
      }
    }
  }

  function saveDailyReview() {
    var date = $('daily-date').value;
    if (!date) { showToast('请选择日期'); return; }

    var data = {
      date: date,
      mood: $('daily-mood').value,
      done: $('daily-done').value.trim(),
      highlight: $('daily-highlight').value.trim(),
      reflect: $('daily-reflect').value.trim(),
      tomorrow: $('daily-tomorrow').value.trim()
    };

    var existing = DB.dailyReviews.find(function(r) { return r.date === date; });
    if (existing) {
      Object.assign(existing, data);
      DB.save('daily');
    } else {
      data.id = DB.genId();
      data.createdAt = new Date().toISOString();
      DB.dailyReviews.unshift(data);
      DB.save('daily');
    }

    showToast('日复盘已保存');
    loadDailyReview();
    renderDailyHistory();
  }

  function renderDailyHistory() {
    var reviews = DB.dailyReviews.slice().sort(function(a, b) {
      return new Date(b.date) - new Date(a.date);
    });

    if (reviews.length === 0) {
      $('dailyHistoryCard').style.display = 'none';
      return;
    }

    $('dailyHistoryCard').style.display = '';
    var html = '';
    reviews.slice(0, 14).forEach(function(r) {
      var d = new Date(r.date);
      var wd = ['日','一','二','三','四','五','六'][d.getDay()];
      var moodTag = r.mood ? '<span class="tag tag-accent">' + r.mood + '</span>' : '';

      html += '<div style="border:1px solid var(--rule);border-radius:8px;padding:12px;margin-bottom:10px;cursor:pointer;" onclick="editDailyReview(\'' + r.date + '\')">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">';
      html += '<span style="font-weight:700;font-size:13px;">' + r.date.slice(5) + ' 周' + wd + '</span>';
      html += moodTag;
      html += '</div>';
      if (r.done) html += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;"><strong>完成：</strong>' + r.done.slice(0, 120) + (r.done.length > 120 ? '...' : '') + '</div>';
      if (r.highlight) html += '<div style="font-size:12px;color:var(--accent);margin-bottom:4px;"><strong>亮点：</strong>' + r.highlight.slice(0, 100) + (r.highlight.length > 100 ? '...' : '') + '</div>';
      if (r.reflect) html += '<div style="font-size:12px;color:var(--muted);margin-bottom:4px;"><strong>反思：</strong>' + r.reflect.slice(0, 100) + (r.reflect.length > 100 ? '...' : '') + '</div>';
      if (r.tomorrow) html += '<div style="font-size:12px;color:var(--accent2);"><strong>明日：</strong>' + r.tomorrow.slice(0, 100) + (r.tomorrow.length > 100 ? '...' : '') + '</div>';
      html += '</div>';
    });
    $('dailyHistory').innerHTML = html;
  }

  function editDailyReview(date) {
    $('daily-date').value = date;
    loadDailyReview();
    $('daily-date').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function toggleDailyHistory() {
    var hist = $('dailyHistory');
    var btn = $('dailyToggleBtn');
    if (hist.style.display === 'none') {
      hist.style.display = '';
      btn.textContent = '收起';
    } else {
      hist.style.display = 'none';
      btn.textContent = '展开';
    }
  }

  // ========== 今日复盘快捷弹窗 ==========
  function openDailyModal() {
    var today = new Date().toISOString().slice(0, 10);
    $('modal-daily-date').value = today;
    loadDailyModal();
    $('dailyModal').classList.add('show');
  }

  function loadDailyModal() {
    var date = $('modal-daily-date').value;
    if (!date) return;

    var existing = DB.dailyReviews.find(function(r) { return r.date === date; });
    if (existing) {
      $('modal-daily-mood').value = existing.mood || '';
      $('modal-daily-done').value = existing.done || '';
      $('modal-daily-highlight').value = existing.highlight || '';
      $('modal-daily-reflect').value = existing.reflect || '';
      $('modal-daily-tomorrow').value = existing.tomorrow || '';
    } else {
      $('modal-daily-mood').value = '';
      $('modal-daily-done').value = '';
      $('modal-daily-highlight').value = '';
      $('modal-daily-reflect').value = '';
      $('modal-daily-tomorrow').value = '';
      // 继承昨日计划
      var prevDate = new Date(date);
      prevDate.setDate(prevDate.getDate() - 1);
      var prevDateStr = prevDate.toISOString().slice(0, 10);
      var prev = DB.dailyReviews.find(function(r) { return r.date === prevDateStr; });
      if (prev && prev.tomorrow) {
        $('modal-daily-done').value = '（昨日计划）' + prev.tomorrow;
      }
    }
  }

  function saveDailyModal() {
    var date = $('modal-daily-date').value;
    if (!date) { showToast('请选择日期'); return; }

    var data = {
      date: date,
      mood: $('modal-daily-mood').value,
      done: $('modal-daily-done').value.trim(),
      highlight: $('modal-daily-highlight').value.trim(),
      reflect: $('modal-daily-reflect').value.trim(),
      tomorrow: $('modal-daily-tomorrow').value.trim()
    };

    var existing = DB.dailyReviews.find(function(r) { return r.date === date; });
    if (existing) {
      Object.assign(existing, data);
      DB.save('daily');
    } else {
      data.id = DB.genId();
      data.createdAt = new Date().toISOString();
      DB.dailyReviews.unshift(data);
      DB.save('daily');
    }

    showToast('日复盘已保存');
    closeModal('dailyModal');
  }

  // ========== SOP 工具箱 ==========
  function renderToolkit() {
    // 内容模板
    var templates = [
      {
        title: '深度图文（公众号）',
        body: '痛点 Hook → 核心观点 → 3 个论据（数据+案例）→ 方法论总结 → 互动 CTA\n建议字数：2000-4000 字'
      },
      {
        title: '中长视频（B站/YouTube）',
        body: '3 秒 Hook → 背景引入 → 正文分段（每段 2-3 分钟）→ 金句总结 → 点赞关注 CTA\n建议时长：8-15 分钟'
      },
      {
        title: '短视频（抖音/视频号）',
        body: '黄金 3 秒（冲突/悬念）→ 快速展开 → 反转/高潮 → 简洁 CTA\n建议时长：60-180 秒'
      },
      {
        title: '小红书图文',
        body: '吸睛标题 → 第一张封面图（大字报风格）→ 干货分点 → 个人体验 → 互动提问\n建议：300-800 字 + 6-9 图'
      }
    ];

    var tHtml = '';
    templates.forEach(function(t, i) {
      tHtml += '<div class="template-card" onclick="copyTemplate(' + i + ')">';
      tHtml += '<div class="tc-header"><div class="tc-title">' + t.title + '</div><div class="tc-copy">📋 点击复制</div></div>';
      tHtml += '<div class="tc-body">' + t.body.replace(/\n/g, '<br>') + '</div>';
      tHtml += '</div>';
    });
    $('templateList').innerHTML = tHtml;

    // 发布清单
    var checklist = [
      '标题：各平台标题已适配',
      '封面：尺寸正确，缩略图可读',
      '正文：无错别字、无违规词',
      '链接：外链有效，导流路径通',
      'CTA：互动引导已添加',
      '分辨率：视频 1080p+，图片不模糊',
      '格式：各平台推荐格式（MP4/JPG）',
      '标签：话题标签 3-5 个已配置',
      '描述：SEO 描述文案已写',
      '定时：设定黄金时段发布'
    ];
    var cHtml = '';
    checklist.forEach(function(item, i) {
      cHtml += '<div class="checklist-item"><input type="checkbox" id="chk-' + i + '"><label for="chk-' + i + '">' + item + '</label></div>';
    });
    $('publishChecklist').innerHTML = cHtml;

    // 平台规格
    $('specTable').innerHTML =
      '<table><thead><tr><th>平台</th><th>封面尺寸</th><th>内容规格</th><th>最佳发布</th></tr></thead><tbody>' +
      '<tr><td><strong>B站</strong></td><td>1146×717</td><td>10-15 分钟视频</td><td>18:00-22:00</td></tr>' +
      '<tr><td><strong>YouTube</strong></td><td>1280×720</td><td>同上 + 双语字幕</td><td>16:00-20:00</td></tr>' +
      '<tr><td><strong>公众号</strong></td><td>900×383 头图</td><td>2000-4000 字</td><td>8:00 / 20:00</td></tr>' +
      '<tr><td><strong>抖音</strong></td><td>1080×1920 竖屏</td><td>60-180 秒</td><td>12:00 / 18:00-22:00</td></tr>' +
      '<tr><td><strong>视频号</strong></td><td>1080×1920 竖屏</td><td>60-180 秒</td><td>同上</td></tr>' +
      '<tr><td><strong>小红书</strong></td><td>1080×1440</td><td>800 字 + 6-9 图</td><td>12:00 / 20:00</td></tr>' +
      '</tbody></table>';

    // 标题公式
    var formulas = [
      { type: '数字型', examples: '"3 个方法让你…" "90% 的人不知道…" "我用 30 天验证了…"' },
      { type: '疑问型', examples: '"为什么…" "怎样才能…" "…真的有用吗？"' },
      { type: '冲突型', examples: '"别再…了" "我后悔没有早点…" "… vs …谁更强"' },
      { type: '故事型', examples: '"我从月薪 3k 到 3w 的真实经历" "那天我差点…"' }
    ];
    var fHtml = '';
    formulas.forEach(function(f) {
      fHtml += '<div class="template-card"><div class="tc-header"><div class="tc-title">' + f.type + '</div></div>';
      fHtml += '<div class="tc-body">' + f.examples + '</div></div>';
    });
    $('titleFormulas').innerHTML = fHtml;
  }

  function copyTemplate(index) {
    var templates = [
      '痛点 Hook → 核心观点 → 3 个论据（数据+案例）→ 方法论总结 → 互动 CTA\n建议字数：2000-4000 字',
      '3 秒 Hook → 背景引入 → 正文分段（每段 2-3 分钟）→ 金句总结 → 点赞关注 CTA\n建议时长：8-15 分钟',
      '黄金 3 秒（冲突/悬念）→ 快速展开 → 反转/高潮 → 简洁 CTA\n建议时长：60-180 秒',
      '吸睛标题 → 第一张封面图（大字报风格）→ 干货分点 → 个人体验 → 互动提问\n建议：300-800 字 + 6-9 图'
    ];
    var text = templates[index] || '';
    navigator.clipboard.writeText(text).then(function() {
      showToast('模板已复制到剪贴板');
    }).catch(function() {
      showToast('复制失败，请手动选择');
    });
  }

  // ========== 导入导出 ==========
  function exportData() {
    var allData = {
      topics: DB.topics,
      dataRecords: DB.dataRecords,
      reviews: DB.reviews,
      dailyReviews: DB.dailyReviews,
        inboxItems: DB.inboxItems,
      settings: DB.settings,
      exportDate: new Date().toISOString()
    };
    var blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'OPC备份_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('备份已导出');
  }

  function importData() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(ev) {
        try {
          var data = JSON.parse(ev.target.result);
          if (data.topics) DB.topics = data.topics;
          if (data.dataRecords) DB.dataRecords = data.dataRecords;
          if (data.reviews) DB.reviews = data.reviews;
          if (data.dailyReviews) DB.dailyReviews = data.dailyReviews;
        if (data.inboxItems) DB.inboxItems = data.inboxItems;
          if (data.settings) DB.settings = data.settings;
          DB.save();
          showToast('数据已导入');
          navigate('dashboard');
        } catch(err) {
          showToast('导入失败：文件格式错误');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function closeModal(id) {
    $(id).classList.remove('show');
  }

  // ========== 初始化 ==========
  function init() {
    DB.load();
    Sync.loadConfig();
    updateThemeControl();

    // 同步指示器初始化
    if (Sync.isConfigured()) {
      Sync.updateIndicator('synced');
    }

    // 日期
    var now = new Date();
    var weekDay = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    $('topbarDate').innerHTML = '📅 ' + (now.getMonth() + 1) + '月' + now.getDate() + '日 周' + weekDay;

    // 导航绑定
    $$('.nav-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        navigate(this.getAttribute('data-page'));
      });
    });

    // 分数实时更新
    ['topic-traffic', 'topic-difficulty', 'topic-match'].forEach(function(id) {
      $(id).addEventListener('input', updateTopicScore);
    });

    // 首屏渲染
    renderDashboard();
    renderToolkit(); // 预加载工具箱内容

    // 首次使用时添加示例数据
    if (DB.topics.length === 0 && DB.dataRecords.length === 0) {
      addSampleData();
    }
  }

  function addSampleData() {
    // ===== 选题（8 个，含六维评分和加工信息）=====
    DB.addTopic({
      title: 'AI 工具实测：5 款提效 300% 的神器', source: '评论区高频问题', form: '中长视频',
      traffic: 5, difficulty: 4, match: 5, timeliness: 4, monetization: 5, reuse: 5,
      platforms: 'B站/YouTube', status: '已发布', note: '本周重点',
      processing: { role: 'parent', status: 'done', adaptations: [
        {platform:'B站',status:'done'},{platform:'YouTube',status:'done'},{platform:'公众号',status:'done'},
        {platform:'抖音',status:'done'},{platform:'小红书',status:'done'}
      ], notes: '母内容为B站长视频，已适配全平台' }
    });
    DB.addTopic({
      title: '新手做自媒体最容易踩的 7 个坑', source: '个人经验总结', form: '深度图文',
      traffic: 4, difficulty: 5, match: 4, timeliness: 5, monetization: 2, reuse: 4,
      platforms: '公众号', status: '已发布', note: '',
      processing: { role: 'parent', status: 'done', adaptations: [
        {platform:'公众号',status:'done'},{platform:'小红书',status:'done'},{platform:'视频号',status:'done'}
      ], notes: '公众号深度文为母内容' }
    });
    DB.addTopic({
      title: '为什么 90% 的人做副业都失败了？', source: '知乎热榜', form: '短视频',
      traffic: 5, difficulty: 5, match: 3, timeliness: 2, monetization: 3, reuse: 3,
      platforms: '抖音/视频号', status: '已发布', note: '争议性话题',
      processing: { role: 'parent', status: 'done', adaptations: [
        {platform:'抖音',status:'done'},{platform:'视频号',status:'done'},{platform:'小红书',status:'processing'}
      ], notes: '争议性强，评论区活跃' }
    });
    DB.addTopic({
      title: '2026 年自媒体还能做吗？深度数据分析', source: '行业报告', form: '深度图文',
      traffic: 4, difficulty: 3, match: 5, timeliness: 3, monetization: 4, reuse: 4,
      platforms: '公众号/B站', status: '创作中', note: '需要调研数据',
      processing: { role: 'parent', status: 'processing', adaptations: [
        {platform:'公众号',status:'processing'},{platform:'B站',status:'none'}
      ], notes: '正在收集行业数据' }
    });
    DB.addTopic({
      title: '我用 Notion 搭建了完整的内容管理系统', source: '粉丝私信', form: '中长视频',
      traffic: 4, difficulty: 3, match: 4, timeliness: 4, monetization: 3, reuse: 5,
      platforms: 'B站/小红书', status: '已排期', note: '教程类',
      processing: { role: 'parent', status: 'none', adaptations: [], notes: '' }
    });
    DB.addTopic({
      title: '月入过万的博主都在用什么设备？', source: '评论区', form: '短视频',
      traffic: 5, difficulty: 4, match: 4, timeliness: 3, monetization: 5, reuse: 3,
      platforms: '抖音/视频号', status: '待评估', note: '可接设备商单',
      processing: { role: 'parent', status: 'none', adaptations: [], notes: '' }
    });
    DB.addTopic({
      title: '从 0 到 10 万粉丝：我的 6 个月复盘', source: '个人里程碑', form: '深度图文',
      traffic: 5, difficulty: 4, match: 5, timeliness: 4, monetization: 3, reuse: 4,
      platforms: '公众号/知乎', status: '灵感', note: '等粉丝到 10 万再发',
      processing: { role: 'parent', status: 'none', adaptations: [], notes: '' }
    });
    DB.addTopic({
      title: 'B站 vs 抖音：哪个平台更适合新手？', source: '知乎', form: '深度图文',
      traffic: 4, difficulty: 5, match: 4, timeliness: 3, monetization: 2, reuse: 3,
      platforms: '公众号/知乎', status: '灵感', note: '对比类内容',
      processing: { role: 'parent', status: 'none', adaptations: [], notes: '' }
    });

    // ===== 数据记录（20 条，覆盖全部 8 个平台）=====

    // --- B站（3 条）---
    DB.addData({ date: '2026-07-20', platform: 'B站', title: 'AI 工具实测（B站完整版）',
      views: 12500, likes: 620, comments: 128, shares: 85, favorites: 320, followers: 52, note: '爆款' });
    DB.addData({ date: '2026-07-24', platform: 'B站', title: '自媒体工具箱 Ep.3',
      views: 8200, likes: 380, comments: 65, shares: 40, favorites: 180, followers: 28, note: '' });
    DB.addData({ date: '2026-07-28', platform: 'B站', title: 'AI 工具实测（B站版）',
      views: 8500, likes: 420, comments: 85, shares: 60, favorites: 180, followers: 35, note: '数据超预期' });

    // --- YouTube（2 条）---
    DB.addData({ date: '2026-07-21', platform: 'YouTube', title: 'AI Tools Review (Full)',
      views: 5200, likes: 310, comments: 48, shares: 25, favorites: 95, followers: 18, note: '英文受众' });
    DB.addData({ date: '2026-07-27', platform: 'YouTube', title: 'Content Creator Workflow',
      views: 3800, likes: 220, comments: 35, shares: 18, favorites: 72, followers: 15, note: '' });

    // --- 公众号（3 条）---
    DB.addData({ date: '2026-07-22', platform: '公众号', title: '新手做自媒体最容易踩的 7 个坑',
      views: 4800, likes: 234, comments: 56, shares: 89, favorites: 280, followers: 25, note: '转发率高' });
    DB.addData({ date: '2026-07-25', platform: '公众号', title: 'AI 工具实测（公众号深度版）',
      views: 3200, likes: 156, comments: 32, shares: 28, favorites: 95, followers: 12, note: '' });
    DB.addData({ date: '2026-07-29', platform: '公众号', title: '内容创作者的时间管理术',
      views: 2600, likes: 110, comments: 24, shares: 42, favorites: 150, followers: 8, note: '' });

    // --- 抖音（3 条）---
    DB.addData({ date: '2026-07-23', platform: '抖音', title: 'AI 工具实测（抖音切片 1）',
      views: 22000, likes: 890, comments: 156, shares: 120, favorites: 310, followers: 65, note: '播放量最高' });
    DB.addData({ date: '2026-07-26', platform: '抖音', title: '3 个让你效率翻倍的方法',
      views: 18000, likes: 720, comments: 98, shares: 85, favorites: 245, followers: 52, note: '' });
    DB.addData({ date: '2026-07-29', platform: '抖音', title: 'AI 工具实测（抖音切片 2）',
      views: 15000, likes: 680, comments: 120, shares: 90, favorites: 210, followers: 48, note: '短视频表现好' });

    // --- 视频号（2 条）---
    DB.addData({ date: '2026-07-24', platform: '视频号', title: '新手自媒体避坑指南',
      views: 6500, likes: 320, comments: 48, shares: 72, favorites: 165, followers: 22, note: '中老年受众' });
    DB.addData({ date: '2026-07-28', platform: '视频号', title: '为什么 90% 的人做副业都失败了',
      views: 9200, likes: 480, comments: 85, shares: 130, favorites: 198, followers: 38, note: '争议性爆了' });

    // --- 小红书（3 条）---
    DB.addData({ date: '2026-07-23', platform: '小红书', title: 'AI 工具实测（小红书图文版）',
      views: 4200, likes: 310, comments: 45, shares: 35, favorites: 280, followers: 22, note: '收藏率高' });
    DB.addData({ date: '2026-07-26', platform: '小红书', title: '自媒体必备工具清单',
      views: 5600, likes: 420, comments: 62, shares: 48, favorites: 380, followers: 35, note: '收藏破纪录' });
    DB.addData({ date: '2026-07-29', platform: '小红书', title: '博主的一天 vlog',
      views: 3800, likes: 280, comments: 38, shares: 22, favorites: 145, followers: 18, note: '' });

    // --- 微博（1 条）---
    DB.addData({ date: '2026-07-25', platform: '微博', title: 'AI 工具实测（精华版）',
      views: 8800, likes: 245, comments: 68, shares: 42, favorites: 55, followers: 15, note: '' });

    // --- 知乎（2 条）---
    DB.addData({ date: '2026-07-22', platform: '知乎', title: '如何看待 2026 年自媒体行业？',
      views: 6200, likes: 380, comments: 92, shares: 56, favorites: 210, followers: 28, note: '长尾流量' });
    DB.addData({ date: '2026-07-27', platform: '知乎', title: '做自媒体最需要什么能力？',
      views: 4500, likes: 256, comments: 78, shares: 38, favorites: 165, followers: 20, note: '' });

    // ===== 数据邮箱示例（20 条）=====
    DB.inboxItems = [
      { id: DB.genId(), title: 'AI 手机大战全面开打', category: '热点话题', source: '百度热搜', heat: 8950000, suggestForm: '短视频', summary: '各大手机厂商纷纷推出 AI 功能，可作为科技数码方向的深度评测选题', url: '', status: 'unread', collectedAt: '2026-07-30T08:00:00Z' },
      { id: DB.genId(), title: '3万亿长鑫背后的清华圈子', category: '行业动态', source: '百度热搜', heat: 5670000, suggestForm: '深度图文', summary: '芯片产业背后的高校人脉网络，适合做商业分析类内容', url: '', status: 'unread', collectedAt: '2026-07-30T08:00:00Z' },
      { id: DB.genId(), title: '已经忘了微信是怎么取代QQ的了', category: '热点话题', source: '百度热搜', heat: 7230000, suggestForm: '短视频', summary: '引发大量讨论，适合做回忆杀/社交变迁类内容', url: '', status: 'starred', collectedAt: '2026-07-30T08:00:00Z' },
      { id: DB.genId(), title: '某头部博主发布月入百万复盘视频', category: '竞品内容', source: 'B站', heat: 6090000, suggestForm: '中长视频', summary: '播放 600 万+，可拆解其内容结构和商业模式', url: '', status: 'unread', collectedAt: '2026-07-29T12:00:00Z' },
      { id: DB.genId(), title: '抖音更新算法：优先推荐完播率高的内容', category: '平台政策', source: '官方公告', heat: 0, suggestForm: '短视频', summary: '完播率权重提升，需要调整内容节奏和开头 Hook 策略', url: '', status: 'starred', collectedAt: '2026-07-29T12:00:00Z' },
      { id: DB.genId(), title: 'Claude 4 发布：多模态能力大幅提升', category: 'AI工具', source: '行业媒体', heat: 4500000, suggestForm: '深度图文', summary: '新模型可处理图片+文本，适合做工具实测', url: '', status: 'unread', collectedAt: '2026-07-29T08:00:00Z' },
      { id: DB.genId(), title: '广东人饭前烫碗的含金量还在上升', category: '热点话题', source: '百度热搜', heat: 3400000, suggestForm: '短视频', summary: '地域文化话题，互动性强，适合做轻松类内容', url: '', status: 'unread', collectedAt: '2026-07-29T08:00:00Z' },
      { id: DB.genId(), title: 'B站 UP 主商业变现新政策解读', category: '平台政策', source: 'B站', heat: 0, suggestForm: '深度图文', summary: '创作激励规则调整，影响所有B站创作者收入', url: '', status: 'converted', collectedAt: '2026-07-28T12:00:00Z' },
      { id: DB.genId(), title: '某AI视频生成工具获得5000万融资', category: 'AI工具', source: '行业媒体', heat: 1200000, suggestForm: '中长视频', summary: '可做产品评测+行业分析，变现潜力高', url: '', status: 'unread', collectedAt: '2026-07-28T08:00:00Z' },
      { id: DB.genId(), title: '小红书推出「好物体验」新功能', category: '平台政策', source: '小红书', heat: 0, suggestForm: '小红书图文', summary: '新功能带来新的流量入口，适合做教程类内容', url: '', status: 'archived', collectedAt: '2026-07-27T12:00:00Z' },
      { id: DB.genId(), title: '某百万粉博主宣布停更', category: '竞品内容', source: '微博热搜', heat: 8900000, suggestForm: '深度图文', summary: '引发创作者群体讨论，适合做行业反思类内容', url: '', status: 'starred', collectedAt: '2026-07-27T08:00:00Z' },
      { id: DB.genId(), title: '视频号打通微信生态全链路', category: '平台政策', source: '微信公开课', heat: 0, suggestForm: '深度图文', summary: '视频号可挂载小程序、跳转公众号，商业化路径更清晰', url: '', status: 'unread', collectedAt: '2026-07-26T12:00:00Z' },
      { id: DB.genId(), title: '演员修杰楷当庭认罪引发热议', category: '热点话题', source: '百度热搜', heat: 6800000, suggestForm: '短视频', summary: '明星话题热度高，可做观点评论类内容', url: '', status: 'unread', collectedAt: '2026-07-30T08:00:00Z' },
      { id: DB.genId(), title: '赵心童6比2淘汰丁俊晖', category: '热点话题', source: '百度热搜', heat: 5200000, suggestForm: '短视频', summary: '体育赛事热点，适合做速报+赛后分析', url: '', status: 'unread', collectedAt: '2026-07-30T08:00:00Z' },
      { id: DB.genId(), title: '某测评博主用AI做了整条视频获百万播放', category: '竞品内容', source: 'B站', heat: 2800000, suggestForm: '中长视频', summary: 'AI生成内容案例，可拆解其工作流并复刻', url: '', status: 'unread', collectedAt: '2026-07-28T12:00:00Z' },
      { id: DB.genId(), title: 'GPT-5 内测曝光：推理能力提升10倍', category: 'AI工具', source: '推特', heat: 9800000, suggestForm: '深度图文', summary: '重磅AI新闻，第一时间做解读内容流量极大', url: '', status: 'starred', collectedAt: '2026-07-30T12:00:00Z' },
      { id: DB.genId(), title: '三伏天公园又现赤裸晒背', category: '热点话题', source: '百度热搜', heat: 2100000, suggestForm: '短视频', summary: '养生话题自带争议，评论区容易爆', url: '', status: 'unread', collectedAt: '2026-07-29T08:00:00Z' },
      { id: DB.genId(), title: '某知识区UP主用Notion搭建内容数据库爆火', category: '竞品内容', source: 'B站', heat: 1500000, suggestForm: '中长视频', summary: '工具教程类内容，可直接对标做同类选题', url: '', status: 'unread', collectedAt: '2026-07-27T12:00:00Z' },
      { id: DB.genId(), title: 'YouTube Shorts 分成计划扩大到所有创作者', category: '平台政策', source: 'YouTube官方', heat: 0, suggestForm: '短视频', summary: '变现门槛降低，做YouTube短视频的时机到了', url: '', status: 'starred', collectedAt: '2026-07-26T08:00:00Z' },
      { id: DB.genId(), title: '某小红书博主一条图文带货10万+', category: '竞品内容', source: '小红书', heat: 3200000, suggestForm: '小红书图文', summary: '拆解其选品和文案策略，适合做变现复盘', url: '', status: 'unread', collectedAt: '2026-07-25T12:00:00Z' }
    ];
    DB.save('inbox');

    renderDashboard();
    updateBadge();
  }

  function resetSampleData() {
    // 清空所有数据
    DB.topics = [];
    DB.dataRecords = [];
    DB.reviews = [];
    DB.dailyReviews = [];
    DB.inboxItems = [];
    DB.save();
    // 重新加载示例数据
    addSampleData();
    showToast('示例数据已重置（8 选题 + 20 数据 + 20 邮箱）');
    navigate('dashboard');
  }
  window.navigate = navigate;
  window.openTopicModal = openTopicModal;
  window.openDataModal = openDataModal;
  window.saveTopic = saveTopic;
  window.saveData = saveData;
  window.saveReview = saveReview;
  window.loadDailyReview = loadDailyReview;
  window.saveDailyReview = saveDailyReview;
  window.editDailyReview = editDailyReview;
  window.toggleDailyHistory = toggleDailyHistory;
  window.openDailyModal = openDailyModal;
  window.loadDailyModal = loadDailyModal;
  window.saveDailyModal = saveDailyModal;
  window.editTopic = editTopic;
  window.deleteTopicConfirm = deleteTopicConfirm;
  window.deleteDataConfirm = deleteDataConfirm;
  window.updateTopicStatus = updateTopicStatus;
  window.closeModal = closeModal;
  window.exportData = exportData;
  window.importData = importData;
  window.copyTemplate = copyTemplate;
  window.updateTopicScore = updateTopicScore;
  window.renderInbox = renderInbox;
  window.openInboxAddModal = openInboxAddModal;
  window.saveInboxItem = saveInboxItem;
  window.convertInboxToTopic = convertInboxToTopic;
  window.confirmConvert = confirmConvert;
  window.toggleInboxStar = toggleInboxStar;
  window.archiveInboxItem = archiveInboxItem;
  window.markAllRead = markAllRead;
  window.renderBoard = renderBoard;
  window.openScoreModal = openScoreModal;
  window.loadScoreData = loadScoreData;
  window.updateScoreTotal = updateScoreTotal;
  window.saveScore = saveScore;
  window.openProcessModal = openProcessModal;
  window.loadProcessData = loadProcessData;
  window.toggleParentGroup = toggleParentGroup;
  window.saveProcess = saveProcess;
  window.switchPlatformTab = switchPlatformTab;
  window.resetSampleData = resetSampleData;
  window.openSyncSettings = function() { Sync.openSettings(); };
  window.saveSyncConfig = function() {
    Sync.config.username = $('sync-username').value.trim();
    Sync.config.repo = $('sync-repo').value.trim();
    Sync.config.branch = $('sync-branch').value.trim() || 'main';
    Sync.config.token = $('sync-token').value.trim();
    Sync.config.autoSync = $('sync-auto').checked;
    Sync.saveConfig();
    showToast('配置已保存');
    Sync.updateIndicator(Sync.isConfigured() ? 'synced' : 'offline');
    Sync.openSettings(); // 刷新状态显示
  };
  window.testSync = function() { Sync.test(); };
  window.pushData = function() {
    Sync.push().then(function() { showToast('✅ 数据已推送到 GitHub'); })
      .catch(function() { showToast('❌ 推送失败，请检查配置'); });
  };
  window.pullData = function() {
    Sync.pull().then(function(ok) { if (ok) { navigate('dashboard'); } })
      .catch(function() { showToast('❌ 拉取失败'); });
  };
  window.manualSync = function() {
    if (!Sync.isConfigured()) { Sync.openSettings(); return; }
    Sync.push().then(function() { showToast('✅ 同步成功'); })
      .catch(function() { showToast('❌ 同步失败'); });
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
