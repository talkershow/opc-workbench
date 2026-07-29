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
})();
