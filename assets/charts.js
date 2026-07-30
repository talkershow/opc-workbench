/* ========== OPC 工作台 · 图表渲染 ========== */
(function() {
  'use strict';

  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim() || '#6366f1';
  var accent2 = style.getPropertyValue('--accent2').trim() || '#ec4899';
  var ink = style.getPropertyValue('--ink').trim() || '#1a1d29';
  var muted = style.getPropertyValue('--muted').trim() || '#6b7280';
  var rule = style.getPropertyValue('--rule').trim() || '#e5e7eb';
  var bg2 = style.getPropertyValue('--bg2').trim() || '#ffffff';

  var charts = {};

  function initChart(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    if (charts[id]) { charts[id].dispose(); }
    charts[id] = echarts.init(el, null, { renderer: 'svg' });
    return charts[id];
  }

  // ========== 仪表盘：数据趋势 ==========
  window.renderDashCharts = function(data, topics) {
    // 趋势折线图
    var trendChart = initChart('chart-dash-trend');
    if (trendChart) {
      var sorted = data.slice().sort(function(a, b) {
        return new Date(a.date) - new Date(b.date);
      });
      var dates = sorted.map(function(d) { return d.date; });
      var views = sorted.map(function(d) { return d.views || 0; });

      trendChart.setOption({
        animation: false,
        tooltip: { trigger: 'axis', appendToBody: true },
        grid: { top: 20, right: 20, bottom: 30, left: 50 },
        xAxis: {
          type: 'category', data: dates,
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11, rotate: dates.length > 5 ? 30 : 0 }
        },
        yAxis: {
          type: 'value',
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11,
            formatter: function(v) {
              if (v >= 10000) return (v / 10000).toFixed(0) + '万';
              return v;
            }
          },
          splitLine: { lineStyle: { color: rule } }
        },
        series: [{
          type: 'line', data: views, smooth: true,
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: accent + '30' }, { offset: 1, color: accent + '05' }]
          }}
        }]
      });
      window.addEventListener('resize', function() { trendChart.resize(); });
    }

    // 选题状态分布饼图
    var topicChart = initChart('chart-dash-topics');
    if (topicChart) {
      var statusCount = {};
      topics.forEach(function(t) {
        var s = t.status || '灵感';
        statusCount[s] = (statusCount[s] || 0) + 1;
      });
      var pieData = Object.keys(statusCount).map(function(s) {
        return { name: s, value: statusCount[s] };
      });
      var colors = [muted, '#f59e0b', accent, accent2, '#10b981'];

      topicChart.setOption({
        animation: false,
        tooltip: { trigger: 'item', appendToBody: true },
        legend: { bottom: 0, textStyle: { color: muted, fontSize: 12 }, itemWidth: 12, itemHeight: 8 },
        series: [{
          type: 'pie', radius: ['40%', '65%'], center: ['50%', '45%'],
          itemStyle: { borderRadius: 6, borderColor: bg2, borderWidth: 2 },
          label: { color: ink, fontSize: 12 },
          data: pieData.map(function(d, i) {
            return { name: d.name, value: d.value, itemStyle: { color: colors[i % colors.length] } };
          })
        }]
      });
      window.addEventListener('resize', function() { topicChart.resize(); });
    }

    // ========== 关键词分布（词云柱状图）==========
    var keywordChart = initChart('chart-dash-keywords');
    if (keywordChart) {
      // 从所有选题标题中提取高频词
      var stopWords = { '的': 1, '了': 1, '是': 1, '在': 1, '我': 1, '你': 1, '他': 1, '她': 1, '它': 1, '们': 1, '和': 1, '与': 1, '及': 1, '或': 1, '也': 1, '都': 1, '但': 1, '不': 1, '没': 1, '有': 1, '这': 1, '那': 1, '一': 1, '个': 1, '中': 1, '上': 1, '下': 1, '到': 1, '为': 1, '把': 1, '被': 1, '让': 1, '给': 1, '向': 1, '从': 1, '对': 1, '跟': 1, '用': 1, '要': 1, '会': 1, '能': 1, '可': 1, '以': 1, '就': 1, '还': 1, '只': 1, '又': 1, '更': 1, '最': 1, '太': 1, '真': 1, '好': 1, '看': 1, '做': 1, '说': 1, '想': 1, '怎么': 1, '什么': 1, '为什么': 1, '如何': 1, '可以': 1, '应该': 1, '需要': 1, '一个': 1, '这个': 1, '那个': 1 };
      var wordCount = {};

      topics.forEach(function(t) {
        var title = t.title || '';
        if (!title) return;

        // 提取 2-4 字的中文片段（简易分词）
        // 先提取英文单词
        var enWords = title.match(/[a-zA-Z]{2,}/g) || [];
        enWords.forEach(function(w) {
          var lw = w.toLowerCase();
          if (!stopWords[lw]) {
            wordCount[lw] = (wordCount[lw] || 0) + 1;
          }
        });

        // 提取数字+关键词
        var numWords = title.match(/\d+/g) || [];
        numWords.forEach(function(n) {
          if (n.length >= 2) {
            wordCount[n] = (wordCount[n] || 0) + 1;
          }
        });

        // 中文 2-3 字组合提取（滑动窗口）
        var cleanTitle = title.replace(/[^\u4e00-\u9fa5]/g, ' ');
        var segments = cleanTitle.split(/\s+/).filter(function(s) { return s.length >= 2; });
        segments.forEach(function(seg) {
          // 提取 2 字词
          for (var i = 0; i <= seg.length - 2; i++) {
            var word2 = seg.substr(i, 2);
            if (!stopWords[word2]) {
              wordCount[word2] = (wordCount[word2] || 0) + 1;
            }
          }
        });
      });

      // 排序取 Top 15
      var sortedWords = Object.keys(wordCount)
        .map(function(k) { return { name: k, value: wordCount[k] }; })
        .filter(function(d) { return d.value >= 1; })
        .sort(function(a, b) { return b.value - a.value; })
        .slice(0, 15)
        .reverse(); // 柱状图从下到上

      if (sortedWords.length === 0) {
        keywordChart.setOption({
          title: { text: '暂无标题数据', left: 'center', top: 'center', textStyle: { color: muted, fontSize: 14 } }
        });
      } else {
        keywordChart.setOption({
          animation: false,
          tooltip: { trigger: 'axis', appendToBody: true, formatter: '{b}: {c} 次' },
          grid: { top: 10, right: 20, bottom: 20, left: 80 },
          xAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: rule } },
            axisLabel: { color: muted, fontSize: 11 },
            splitLine: { lineStyle: { color: rule } }
          },
          yAxis: {
            type: 'category',
            data: sortedWords.map(function(d) { return d.name; }),
            axisLine: { lineStyle: { color: rule } },
            axisLabel: { color: ink, fontSize: 12 }
          },
          series: [{
            type: 'bar',
            data: sortedWords.map(function(d, i) {
              return {
                value: d.value,
                itemStyle: {
                  color: i >= sortedWords.length - 3 ? accent2 : accent,
                  borderRadius: [0, 4, 4, 0]
                }
              };
            }),
            label: { show: true, position: 'right', color: muted, fontSize: 11 }
          }]
        });
      }
      window.addEventListener('resize', function() { keywordChart.resize(); });
    }

    // ========== 来源分布（饼图）==========
    var sourceChart = initChart('chart-dash-sources');
    if (sourceChart) {
      var sourceCount = {};
      topics.forEach(function(t) {
        var s = t.source || '未标注';
        if (!s.trim()) s = '未标注';
        sourceCount[s] = (sourceCount[s] || 0) + 1;
      });
      var sourceData = Object.keys(sourceCount).map(function(s) {
        return { name: s, value: sourceCount[s] };
      }).sort(function(a, b) { return b.value - a.value; });

      var sourceColors = [accent, accent2, '#a78bfa', '#f472b6', '#818cf8', '#fb7185', '#fbbf24', '#34d399', '#22d3ee', '#c084fc'];

      if (sourceData.length === 0) {
        sourceChart.setOption({
          title: { text: '暂无来源数据', left: 'center', top: 'center', textStyle: { color: muted, fontSize: 14 } }
        });
      } else {
        sourceChart.setOption({
          animation: false,
          tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} 个 ({d}%)' },
          legend: {
            type: 'scroll', bottom: 0, left: 'center',
            textStyle: { color: muted, fontSize: 11 },
            itemWidth: 10, itemHeight: 8
          },
          series: [{
            type: 'pie',
            radius: ['35%', '60%'],
            center: ['50%', '42%'],
            itemStyle: { borderRadius: 6, borderColor: bg2, borderWidth: 2 },
            label: {
              color: ink, fontSize: 11,
              formatter: function(p) {
                return p.value >= 2 ? p.name + ' ' + p.value : '';
              }
            },
            data: sourceData.map(function(d, i) {
              return { name: d.name, value: d.value, itemStyle: { color: sourceColors[i % sourceColors.length] } };
            })
          }]
        });
      }
      window.addEventListener('resize', function() { sourceChart.resize(); });
    }
  };

  // ========== 数据追踪页面图表 ==========
  window.renderDataCharts = function(data) {
    // 趋势图
    var trendChart = initChart('chart-data-trend');
    if (trendChart) {
      var sorted = data.slice().sort(function(a, b) {
        return new Date(a.date) - new Date(b.date);
      });
      trendChart.setOption({
        animation: false,
        tooltip: { trigger: 'axis', appendToBody: true },
        legend: { data: ['播放/阅读', '互动总数'], bottom: 0, textStyle: { color: muted, fontSize: 12 } },
        grid: { top: 20, right: 20, bottom: 40, left: 50 },
        xAxis: {
          type: 'category',
          data: sorted.map(function(d) { return d.date; }),
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11, rotate: sorted.length > 5 ? 30 : 0 }
        },
        yAxis: {
          type: 'value',
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11,
            formatter: function(v) { return v >= 10000 ? (v / 10000).toFixed(0) + '万' : v; }
          },
          splitLine: { lineStyle: { color: rule } }
        },
        series: [
          {
            name: '播放/阅读', type: 'bar',
            data: sorted.map(function(d) { return d.views || 0; }),
            itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] }
          },
          {
            name: '互动总数', type: 'line', smooth: true,
            data: sorted.map(function(d) {
              return (d.likes || 0) + (d.comments || 0) + (d.shares || 0) + (d.favorites || 0);
            }),
            lineStyle: { color: accent2, width: 2 },
            itemStyle: { color: accent2 }
          }
        ]
      });
      window.addEventListener('resize', function() { trendChart.resize(); });
    }

    // 平台对比
    var platChart = initChart('chart-data-platform');
    if (platChart) {
      var platStats = {};
      data.forEach(function(d) {
        if (!platStats[d.platform]) platStats[d.platform] = { views: 0, eng: 0, count: 0 };
        platStats[d.platform].views += d.views || 0;
        platStats[d.platform].eng += ((d.likes||0)+(d.comments||0)+(d.shares||0)+(d.favorites||0)) / Math.max(d.views||1,1);
        platStats[d.platform].count++;
      });
      var platNames = Object.keys(platStats);
      var avgEng = platNames.map(function(p) {
        return ((platStats[p].eng / platNames.length) * 100).toFixed(1);
      });

      platChart.setOption({
        animation: false,
        tooltip: { trigger: 'axis', appendToBody: true },
        grid: { top: 20, right: 20, bottom: 30, left: 50 },
        xAxis: {
          type: 'category', data: platNames,
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11 }
        },
        yAxis: [{
          type: 'value', name: '总播放',
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11,
            formatter: function(v) { return v >= 10000 ? (v/10000).toFixed(0)+'万' : v; }
          },
          splitLine: { lineStyle: { color: rule } }
        }],
        series: [{
          type: 'bar',
          data: platNames.map(function(p) { return platStats[p].views; }),
          itemStyle: {
            color: function(p) {
              var palette = [accent, accent2, '#a78bfa', '#f472b6', '#818cf8', '#fb7185'];
              return palette[p.dataIndex % palette.length];
            },
            borderRadius: [4, 4, 0, 0]
          },
          barWidth: '50%'
        }]
      });
      window.addEventListener('resize', function() { platChart.resize(); });
    }
  };

  // ========== 单平台趋势图（双 Y 轴：播放 + 互动率）==========
  window.renderPlatformChart = function(containerId, sortedData, config) {
    var el = document.getElementById(containerId);
    if (!el || !sortedData || sortedData.length === 0) return;

    // 销毁旧图表
    var existing = el.getAttribute('data-echarts-instance');
    if (existing) {
      var old = echarts.getInstanceByDom(el);
      if (old) old.dispose();
    }

    var chart = echarts.init(el, null, { renderer: 'svg' });
    el.setAttribute('data-echarts-instance', '1');

    var dates = sortedData.map(function(d) { return d.date || ''; });
    var views = sortedData.map(function(d) { return Number(d.views) || 0; });
    var engRates = sortedData.map(function(d) {
      var v = Number(d.views) || 1;
      var inter = (Number(d.likes)||0) + (Number(d.comments)||0) + (Number(d.shares)||0) + (Number(d.favorites)||0);
      return Number((inter / v * 100).toFixed(1));
    });
    var followers = sortedData.map(function(d) { return Number(d.followers) || 0; });

    var series = [
      {
        name: config.metrics, type: 'bar',
        data: views,
        itemStyle: { color: config.color, borderRadius: [4, 4, 0, 0] },
        barWidth: '40%'
      },
      {
        name: '互动率(%)', type: 'line', yAxisIndex: 1, smooth: true,
        data: engRates,
        lineStyle: { color: accent2, width: 2 },
        itemStyle: { color: accent2 },
        symbolSize: 6
      }
    ];

    // 如果有涨粉数据，加第三条线
    var hasFollowers = followers.some(function(f) { return f > 0; });
    if (hasFollowers) {
      series.push({
        name: '涨粉', type: 'line', smooth: true,
        data: followers,
        lineStyle: { color: '#10b981', width: 2, type: 'dashed' },
        itemStyle: { color: '#10b981' },
        symbolSize: 5
      });
    }

    chart.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true },
      legend: { bottom: 0, textStyle: { color: muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { top: 20, right: 60, bottom: 40, left: 60 },
      xAxis: {
        type: 'category', data: dates,
        axisLine: { lineStyle: { color: rule } },
        axisLabel: { color: muted, fontSize: 11, rotate: dates.length > 5 ? 30 : 0 }
      },
      yAxis: [
        {
          type: 'value', name: config.metrics,
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11,
            formatter: function(v) { return v >= 10000 ? (v/10000).toFixed(1)+'万' : v; }
          },
          splitLine: { lineStyle: { color: rule } }
        },
        {
          type: 'value', name: '互动率(%)',
          axisLine: { lineStyle: { color: rule } },
          axisLabel: { color: muted, fontSize: 11, formatter: '{value}%' },
          splitLine: { show: false }
        }
      ],
      series: series
    });

    window.addEventListener('resize', function() { chart.resize(); });
  };
})();
