import 'package:flutter/foundation.dart';
import '../core/api.dart';
import '../widgets/common.dart';

class DashboardViewModel extends ChangeNotifier {
  DateTime _date = DateTime.now();
  bool _loading = false;
  int _chartDays = 7;

  int    _ordersCount  = 0;
  double _revenue      = 0;
  double _avgCheck     = 0;
  double _incomeTotal  = 0;
  double _expenseTotal = 0;
  double _yRevenue     = 0;
  int    _yOrdersCount = 0;

  List<double>               _chartData    = List.filled(7, 0);
  List<Map<String, dynamic>> _topDishes    = [];
  List<Map<String, dynamic>> _recentOrders = [];

  // ── Immutable state getters ─────────────────────────────────────────────────
  DateTime get date         => _date;
  bool     get loading      => _loading;
  int      get chartDays    => _chartDays;
  int      get ordersCount  => _ordersCount;
  double   get revenue      => _revenue;
  double   get avgCheck     => _avgCheck;
  double   get incomeTotal  => _incomeTotal;
  double   get expenseTotal => _expenseTotal;
  double   get yRevenue     => _yRevenue;
  int      get yOrdersCount => _yOrdersCount;

  List<double>               get chartData    => List.unmodifiable(_chartData);
  List<Map<String, dynamic>> get topDishes    => List.unmodifiable(_topDishes);
  List<Map<String, dynamic>> get recentOrders => List.unmodifiable(_recentOrders);

  // ── Commands ────────────────────────────────────────────────────────────────
  void prevDay() { _date = _date.subtract(const Duration(days: 1)); load(); }

  void nextDay() {
    final next = _date.add(const Duration(days: 1));
    if (!next.isAfter(DateTime.now())) { _date = next; load(); }
  }

  void pickDay(DateTime d) { _date = d; load(); }

  void setChartDays(int days) { _chartDays = days; load(); }

  String delta(double today, double yesterday) {
    if (yesterday == 0) return today > 0 ? '+100%' : '0%';
    final pct = ((today - yesterday) / yesterday * 100).round();
    return '${pct >= 0 ? '+' : ''}$pct%';
  }

  bool positive(double today, double yesterday) => today >= yesterday;

  Future<void> load() async {
    _loading = true;
    notifyListeners();

    final d     = fmtIsoDate(_date);
    final yd    = fmtIsoDate(_date.subtract(const Duration(days: 1)));
    final wStart = fmtIsoDate(_date.subtract(Duration(days: _chartDays - 1)));

    try {
      final today     = await Api().reportOrders(dateFrom: d, dateTo: d);
      final yesterday = await Api().reportOrders(dateFrom: yd, dateTo: yd);
      final finance   = await Api().financeTransactions(dateFrom: d, dateTo: d);
      final dishes    = await Api().reportDishes(dateFrom: wStart, dateTo: d);
      final week      = await Api().reportOrders(dateFrom: wStart, dateTo: d);

      _ordersCount = today.length;
      _revenue     = today.fold(0.0, (s, o) => s + toDouble(o['total_amount']));
      _avgCheck    = _ordersCount > 0 ? _revenue / _ordersCount : 0;

      _yOrdersCount = yesterday.length;
      _yRevenue     = yesterday.fold(0.0, (s, o) => s + toDouble(o['total_amount']));

      final txItems = (finance['items'] as List? ?? []);
      _incomeTotal  = txItems.where((t) => t['direction'] == 'income')
          .fold(0.0, (s, t) => s + toDouble(t['amount']));
      _expenseTotal = txItems.where((t) => t['direction'] == 'expense')
          .fold(0.0, (s, t) => s + toDouble(t['amount']));

      final byDay = <String, double>{};
      for (int i = 0; i < _chartDays; i++) {
        byDay[fmtIsoDate(_date.subtract(Duration(days: _chartDays - 1 - i)))] = 0;
      }
      for (final o in week) {
        final raw = (o['created_at'] as String?) ?? '';
        if (raw.length >= 10) {
          final day = raw.substring(0, 10);
          byDay[day] = (byDay[day] ?? 0) + toDouble(o['total_amount']);
        }
      }
      _chartData = byDay.values.toList();

      // DishReportRow uses `amount` for revenue — remap to `total` for the shared dish-row UI.
      _topDishes = dishes.map((row) => {
        ...(row as Map<String, dynamic>),
        'total': row['amount'],
      }).toList()
        ..sort((a, b) => toDouble(b['quantity']).compareTo(toDouble(a['quantity'])));

      _recentOrders = List<Map<String, dynamic>>.from(week)
        ..sort((a, b) => ((b['created_at'] ?? '') as String)
            .compareTo((a['created_at'] ?? '') as String));
      if (_recentOrders.length > 10) _recentOrders = _recentOrders.sublist(0, 10);
    } catch (_) {}

    _loading = false;
    notifyListeners();
  }
}
