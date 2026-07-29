/* ========== OPC 工作台 · 核心应用逻辑 ========== */
(function() {
  'use strict';

  // ========== 数据管理 ==========
  var DB = {
    topics: [],
    dataRecords: [],
    reviews: [],
    settings: { lastReviewWeek: '' },

    load: function() {
      try {
        this.topics = JSON.parse(localStorage.getItem('opc_topics') || '[]');
        this.dataRecords = JSON.parse(localStorage.getItem('opc_data') || '[]');
        this.reviews = JSON.parse(localStorage.getItem('opc_reviews') || '[]');
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

  // ========== 导航 ==========
  var pageTitles = {
    dashboard: '仪表盘',
    topics: '选题看板',
    data: '数据追踪',
    hot: '热点快览',
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
    if (page === 'topics') renderTopics();
    if (page === 'data') renderDataPage();
    if (page === 'review') renderReviewPage();
    if (page === 'hot') renderHotPage();
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

    // Badge
    $('badge-topics').textContent = topics.length;

    // 图表
    if (typeof renderDashCharts === 'function') {
      renderDashCharts(data, topics);
    }
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

  function renderDataPage() {
    var data = DB.dataRecords;
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

    // 图表
    if (typeof renderDataCharts === 'function') {
      renderDataCharts(data);
    }
  }

  // ========== 周复盘 ==========
  function renderReviewPage() {
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

  // ========== 热点快览 ==========
  function renderHotPage() {
    // 静态展示常用热搜入口
    var platforms = [
      { name: '微博热搜', icon: '🐦', url: 'https://s.weibo.com/top/summary', color: 'var(--accent)' },
      { name: '知乎热榜', icon: '📚', url: 'https://www.zhihu.com/hot', color: 'var(--accent2)' },
      { name: 'B站热门', icon: '📺', url: 'https://www.bilibili.com/v/popular/all', color: 'var(--accent)' },
      { name: '百度热搜', icon: '🔍', url: 'https://top.baidu.com/board?tab=realtime', color: 'var(--accent2)' },
      { name: '抖音热点', icon: '🎵', url: 'https://www.douyin.com/hot', color: 'var(--accent)' },
      { name: '头条热榜', icon: '📰', url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', color: 'var(--accent2)' }
    ];

    var html = '';
    platforms.forEach(function(p) {
      html += '<div class="quick-card" onclick="window.open(\'' + p.url + '\', \'_blank\')" style="text-align:center;">';
      html += '<div class="qc-icon">' + p.icon + '</div>';
      html += '<div class="qc-title">' + p.name + '</div>';
      html += '<div class="qc-desc">点击查看 ↗</div>';
      html += '</div>';
    });

    html += '<div class="quick-card" onclick="quickAddTopic()" style="grid-column:1/-1;text-align:center;border:2px dashed var(--accent);">';
    html += '<div class="qc-icon">💡</div>';
    html += '<div class="qc-title">发现好话题？快速加入选题库</div>';
    html += '<div class="qc-desc">点击一键添加为选题</div>';
    html += '</div>';

    $('hotGrid').innerHTML = html;
    $('hotUpdateTime').textContent = '点击卡片跳转各平台';
  }

  function quickAddTopic() {
    openTopicModal();
    $('topic-source').value = '热点扫描';
    $('topic-status').value = '灵感';
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
    DB.addTopic({
      title: 'AI 工具实测：5 款提效 300% 的神器',
      source: '评论区高频问题',
      form: '中长视频',
      traffic: 5, difficulty: 4, match: 5,
      platforms: 'B站/YouTube',
      status: '已排期',
      note: '本周重点'
    });
    DB.addTopic({
      title: '新手做自媒体最容易踩的 7 个坑',
      source: '个人经验总结',
      form: '深度图文',
      traffic: 4, difficulty: 5, match: 4,
      platforms: '公众号',
      status: '创作中',
      note: ''
    });
    DB.addTopic({
      title: '为什么 90% 的人做副业都失败了？',
      source: '知乎热榜',
      form: '短视频',
      traffic: 5, difficulty: 5, match: 3,
      platforms: '抖音/视频号',
      status: '灵感',
      note: '争议性话题'
    });

    DB.addData({
      date: '2026-07-28', platform: 'B站', title: 'AI 工具实测（B站版）',
      views: 8500, likes: 420, comments: 85, shares: 60, favorites: 180, followers: 35,
      note: '数据超预期'
    });
    DB.addData({
      date: '2026-07-28', platform: '公众号', title: 'AI 工具实测（公众号版）',
      views: 3200, likes: 156, comments: 32, shares: 28, favorites: 95, followers: 12,
      note: ''
    });
    DB.addData({
      date: '2026-07-29', platform: '抖音', title: 'AI 工具实测（抖音切片）',
      views: 15000, likes: 680, comments: 120, shares: 90, favorites: 210, followers: 48,
      note: '短视频表现好'
    });
    DB.addData({
      date: '2026-07-29', platform: '小红书', title: 'AI 工具实测（小红书）',
      views: 4200, likes: 310, comments: 45, shares: 35, favorites: 280, followers: 22,
      note: '收藏率高'
    });

    renderDashboard();
    updateBadge();
  }

  // ========== 暴露到全局 ==========
  window.navigate = navigate;
  window.openTopicModal = openTopicModal;
  window.openDataModal = openDataModal;
  window.saveTopic = saveTopic;
  window.saveData = saveData;
  window.saveReview = saveReview;
  window.editTopic = editTopic;
  window.deleteTopicConfirm = deleteTopicConfirm;
  window.deleteDataConfirm = deleteDataConfirm;
  window.updateTopicStatus = updateTopicStatus;
  window.closeModal = closeModal;
  window.exportData = exportData;
  window.importData = importData;
  window.copyTemplate = copyTemplate;
  window.quickAddTopic = quickAddTopic;
  window.updateTopicScore = updateTopicScore;
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
