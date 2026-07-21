import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import '../../core/api.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key});
  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  bool _loading = true;
  int _chartDays = 7;

  DateTime _from = DateTime.now().subtract(const Duration(days: 6));
  DateTime _to   = DateTime.now();

  double _totalRevenue = 0;
  int    _totalOrders  = 0;
  double _avgCheck     = 0;
  Map<String, int>    _statusCounts = {};
  List<_PopItem>      _popular      = [];
  List<double>        _dailyRevenue = [];
  List<DateTime>      _dailyDates   = [];

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final df = fmtIsoDate(_from);
      final dt = fmtIsoDate(_to);

      final results = await Future.wait([
        Api().reportOrders(dateFrom: df, dateTo: dt),
        Api().reportDishes(dateFrom: df, dateTo: dt),
      ]);

      final allOrders = List<Map<String, dynamic>>.from(results[0]);
      final dishItems = List<Map<String, dynamic>>.from(results[1]);

      _totalOrders  = allOrders.length;
      _totalRevenue = allOrders.fold(0.0, (s, o) => s + toDouble(o['total_amount']));
      _avgCheck     = _totalOrders > 0 ? _totalRevenue / _totalOrders : 0;

      // Status breakdown
      _statusCounts = {};
      for (final o in allOrders) {
        final s = o['status']?.toString() ?? '';
        if (s.isNotEmpty) _statusCounts[s] = (_statusCounts[s] ?? 0) + 1;
      }

      // Daily revenue by date
      final dayCount = _to.difference(_from).inDays + 1;
      final byDay = <String, double>{};
      _dailyDates = [];
      for (int i = 0; i < dayCount; i++) {
        final d = _from.add(Duration(days: i));
        _dailyDates.add(d);
        byDay[fmtIsoDate(d)] = 0;
      }
      for (final o in allOrders) {
        final raw = (o['created_at'] as String?) ?? '';
        if (raw.length >= 10) {
          final day = raw.substring(0, 10);
          byDay[day] = (byDay[day] ?? 0) + toDouble(o['total'] ?? o['total_amount']);
        }
      }
      _dailyRevenue = byDay.values.toList();

      // Popular dishes from reportDishes
      _popular = dishItems.map((d) => _PopItem(
        d['name']?.toString() ?? '—',
        toInt(d['quantity']),
        toDouble(d['amount']),
      )).toList()..sort((a, b) => b.qty.compareTo(a.qty));
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  void _setRange(int days) {
    setState(() {
      _chartDays = days;
      _from = _to.subtract(Duration(days: days - 1));
    });
    _load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: T.bg,
    appBar: AppBar(
      title: const Text('Аналитика'),
      actions: [
        IconButton(icon: const Icon(Icons.refresh), onPressed: () {
          setState(() => _loading = true);
          _load();
        }),
      ],
    ),
    body: Column(children: [
      _buildDateFilter(),
      Expanded(
        child: _loading
          ? const LoadingCenter()
          : RefreshIndicator(
              color: T.accent,
              onRefresh: _load,
              child: ResponsiveBox(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                  children: [
                    _buildKpi(),
                    _buildPeriodChips(),
                    _buildChart(),
                    _buildStatusSection(),
                    _buildPopularSection(),
                  ],
                ),
              ),
            ),
      ),
    ]),
  );

  Widget _buildDateFilter() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
    child: DateRangeHeader(
      from: _from, to: _to,
      onChanged: (r) {
        setState(() { _from = r.start; _to = r.end; _chartDays = 0; });
        _load();
      },
    ),
  );

  Widget _buildKpi() => Padding(
    padding: const EdgeInsets.only(top: 16, bottom: 8),
    child: Row(children: [
      Expanded(child: _kpiCard('Выручка', fmtNum(_totalRevenue, compact: true), T.success)),
      const SizedBox(width: 8),
      Expanded(child: _kpiCard('Заказов', '$_totalOrders', T.accent)),
      const SizedBox(width: 8),
      Expanded(child: _kpiCard('Ср. чек', fmtNum(_avgCheck, compact: true), T.warning)),
    ]),
  );

  Widget _kpiCard(String label, String value, Color color) => Container(
    padding: const EdgeInsets.all(14),
    decoration: BoxDecoration(
      color: T.surface, borderRadius: BorderRadius.circular(14),
      border: Border.all(color: T.border, width: 0.5),
    ),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
      const SizedBox(height: 2),
      Text(label, style: const TextStyle(color: T.muted, fontSize: 12)),
    ]),
  );

  Widget _buildPeriodChips() => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(children: [
      _pChip('7 дней', 7),
      const SizedBox(width: 8),
      _pChip('14 дней', 14),
      const SizedBox(width: 8),
      _pChip('30 дней', 30),
    ]),
  );

  Widget _pChip(String label, int days) => GestureDetector(
    onTap: () => _setRange(days),
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: _chartDays == days ? T.accent : T.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _chartDays == days ? T.accent : T.border),
      ),
      child: Text(label, style: TextStyle(
        fontSize: 12, fontWeight: FontWeight.w600,
        color: _chartDays == days ? Colors.white : T.muted)),
    ),
  );

  Widget _buildChart() {
    if (_dailyRevenue.isEmpty) return const SizedBox.shrink();
    final maxY = _dailyRevenue.reduce((a, b) => a > b ? a : b);
    final safeMax = maxY > 0 ? maxY * 1.2 : 1.0;

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader('Динамика выручки'),
      SizedBox(height: 185, child: BarChart(BarChartData(
        maxY: safeMax,
        barTouchData: BarTouchData(
          touchTooltipData: BarTouchTooltipData(
            getTooltipColor: (_) => T.surfaceLight,
            tooltipBorder: const BorderSide(color: T.border),
            getTooltipItem: (g, _, rod, __) => BarTooltipItem(
              fmtNum(rod.toY, compact: true),
              const TextStyle(color: T.accent, fontWeight: FontWeight.w700, fontSize: 12)),
          ),
        ),
        gridData: FlGridData(
          show: true, drawVerticalLine: false,
          horizontalInterval: safeMax / 4,
          getDrawingHorizontalLine: (_) => const FlLine(color: T.border, strokeWidth: 0.5),
        ),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          bottomTitles: AxisTitles(sideTitles: SideTitles(
            showTitles: true, reservedSize: 22,
            interval: _dailyDates.length > 14 ? (_dailyDates.length / 7).ceilToDouble() : 1,
            getTitlesWidget: (v, _) {
              final idx = v.toInt();
              if (idx < 0 || idx >= _dailyDates.length) return const SizedBox.shrink();
              final d = _dailyDates[idx];
              return Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text('${d.day.toString().padLeft(2,'0')}.${d.month.toString().padLeft(2,'0')}',
                  style: const TextStyle(color: T.muted, fontSize: 9)),
              );
            },
          )),
        ),
        barGroups: List.generate(_dailyRevenue.length, (i) => BarChartGroupData(
          x: i,
          barRods: [BarChartRodData(
            toY: _dailyRevenue[i],
            color: i == _dailyRevenue.length - 1 ? T.accent : T.accentDark,
            width: _dailyRevenue.length > 14 ? 6 : 14,
            borderRadius: const BorderRadius.only(
              topLeft: Radius.circular(4), topRight: Radius.circular(4)),
          )],
        )),
      ))),
      const SizedBox(height: 8),
    ]);
  }

  Widget _buildStatusSection() {
    if (_statusCounts.isEmpty) return const SizedBox.shrink();
    const labels = {
      'new': 'Новые', 'accepted': 'Приняты', 'cooking': 'Готовятся',
      'ready': 'Готовы', 'completed': 'Закрыты', 'cancelled': 'Отменены',
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader('Статусы заказов'),
      Wrap(spacing: 8, runSpacing: 8,
        children: _statusCounts.entries.map((e) {
          final color = switch(e.key) {
            'new'       => T.accent,
            'accepted'  => const Color(0xFF60A5FA),
            'cooking'   => T.warning,
            'ready'     => T.success,
            'completed' => T.mutedDark,
            'cancelled' => T.danger,
            _           => T.muted,
          };
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10),
              border: Border.all(color: color.withValues(alpha: 0.3)),
            ),
            child: Text('${labels[e.key] ?? e.key}: ${e.value}',
              style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13)),
          );
        }).toList()),
      const SizedBox(height: 8),
    ]);
  }

  Widget _buildPopularSection() {
    if (_popular.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const SectionHeader('Популярные блюда'),
      ..._popular.take(10).toList().asMap().entries.map((e) {
        final i = e.key; final item = e.value;
        final maxQty = _popular.first.qty.toDouble();
        return Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: T.surface, borderRadius: BorderRadius.circular(12),
            border: Border.all(color: T.border, width: 0.5),
          ),
          child: Column(children: [
            Row(children: [
              Container(
                width: 26, height: 26, alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: i < 3 ? T.accent.withValues(alpha: 0.15) : T.surfaceLight,
                  borderRadius: BorderRadius.circular(6)),
                child: Text('${i + 1}', style: TextStyle(
                  fontSize: 11, fontWeight: FontWeight.bold,
                  color: i < 3 ? T.accent : T.muted)),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(item.name, style: const TextStyle(fontSize: 14, color: T.text))),
              Text('×${item.qty}',
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, color: T.text)),
              const SizedBox(width: 8),
              Text('${fmtNum(item.revenue, compact: true)} UZS',
                style: const TextStyle(color: T.muted, fontSize: 12)),
            ]),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: LinearProgressIndicator(
                value: maxQty > 0 ? item.qty / maxQty : 0,
                backgroundColor: T.surfaceLight,
                color: i == 0 ? T.accent : T.accentDark,
                minHeight: 3,
              ),
            ),
          ]),
        );
      }),
    ]);
  }
}

class _PopItem {
  final String name;
  int qty;
  double revenue;
  _PopItem(this.name, this.qty, this.revenue);
}
