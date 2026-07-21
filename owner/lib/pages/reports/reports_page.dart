import 'package:flutter/material.dart';
import '../../core/api.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class ReportsPage extends StatefulWidget {
  const ReportsPage({super.key});
  @override
  State<ReportsPage> createState() => _ReportsPageState();
}

class _ReportsPageState extends State<ReportsPage> with SingleTickerProviderStateMixin {
  late TabController _tabs;
  bool _loading = true;

  DateTime _from = DateTime.now().subtract(const Duration(days: 7));
  DateTime _to   = DateTime.now();

  List<Map<String, dynamic>> _dishes    = [];
  List<Map<String, dynamic>> _waiters   = [];
  List<Map<String, dynamic>> _cancelled = [];

  double _dishesTotal    = 0;
  double _waitersTotal   = 0;
  int    _cancelledCount = 0;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    _load();
  }

  @override
  void dispose() { _tabs.dispose(); super.dispose(); }

  Future<void> _load() async {
    setState(() => _loading = true);
    final df = fmtIsoDate(_from);
    final dt = fmtIsoDate(_to);
    try {
      final results = await Future.wait([
        Api().reportDishes(dateFrom: df, dateTo: dt),
        Api().reportWaiters(dateFrom: df, dateTo: dt),
        Api().reportCancelled(dateFrom: df, dateTo: dt),
      ]);

      final d = results[0];
      final w = results[1];
      final c = results[2];

      // Backend field names (DishReportRow.amount, WaiterReportRow.orders_total)
      // differ from the UI's `total` — remap here rather than touching every widget.
      _dishes = d.map((row) => {
        ...(row as Map<String, dynamic>),
        'total': row['amount'],
      }).toList();
      _waiters = w.map((row) => {
        ...(row as Map<String, dynamic>),
        'total': row['orders_total'],
        'orders': row['orders_count'],
      }).toList();
      // CancelledItemRow is per cancelled dish (no order total/timestamp/reason directly).
      _cancelled = c.map((row) {
        final m     = row as Map<String, dynamic>;
        final qty   = toDouble(m['quantity']);
        final price = toDouble(m['price']);
        return {
          ...m,
          'total': qty * price,
          'created_at': '${m['date'] ?? ''} ${m['time'] ?? ''}'.trim(),
        };
      }).toList();

      _dishesTotal    = _dishes.fold(0.0, (s, r) => s + toDouble(r['total']));
      _waitersTotal   = _waiters.fold(0.0, (s, r) => s + toDouble(r['total']));
      _cancelledCount = _cancelled.length;
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: T.bg,
    appBar: AppBar(
      title: const Text('Отчёты'),
      bottom: TabBar(controller: _tabs, tabs: const [
        Tab(text: 'Блюда'),
        Tab(text: 'Официанты'),
        Tab(text: 'Отмены'),
      ]),
    ),
    body: Column(children: [
      _buildDateFilter(),
      _buildSummary(),
      Expanded(
        child: _loading
          ? const LoadingCenter()
          : TabBarView(controller: _tabs, children: [
              _DishesTab(items: _dishes,    total: _dishesTotal,  onRefresh: _load),
              _WaitersTab(items: _waiters,  total: _waitersTotal, onRefresh: _load),
              _CancelledTab(items: _cancelled, count: _cancelledCount, onRefresh: _load),
            ]),
      ),
    ]),
  );

  Widget _buildDateFilter() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
    child: DateRangeHeader(
      from: _from, to: _to,
      onChanged: (r) {
        setState(() { _from = r.start; _to = r.end; });
        _load();
      },
    ),
  );

  Widget _buildSummary() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
      child: Row(children: [
        _statCard('Выручка (блюда)', fmtNum(_dishesTotal, compact: true), T.accent),
        const SizedBox(width: 8),
        _statCard('Выручка (офиц.)', fmtNum(_waitersTotal, compact: true), T.purple),
        const SizedBox(width: 8),
        _statCard('Отменено', '$_cancelledCount заказов', T.danger),
      ]),
    );
  }

  Widget _statCard(String label, String val, Color color) => Expanded(
    child: Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 10),
      decoration: BoxDecoration(
        color: T.surface, borderRadius: BorderRadius.circular(12),
        border: Border.all(color: T.border, width: 0.5),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 10, color: T.muted)),
        const SizedBox(height: 3),
        Text(val, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color)),
      ]),
    ),
  );
}

// ── Dishes tab ────────────────────────────────────────────────────────────────

class _DishesTab extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  final double total;
  final Future<void> Function() onRefresh;
  const _DishesTab({required this.items, required this.total, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const EmptyState(icon: Icons.restaurant_menu_outlined, message: 'Нет данных по блюдам');
    }
    final maxQty = items.isEmpty ? 1.0 : toDouble(items.first['quantity']);
    return RefreshIndicator(
      color: T.accent,
      onRefresh: onRefresh,
      child: ResponsiveBox(
        child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: items.length,
          itemBuilder: (_, i) {
            final d = items[i];
            final qty = toDouble(d['quantity']);
            final rev = toDouble(d['total']);
            final share = total > 0 ? (rev / total * 100).toStringAsFixed(1) : '0';
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: T.surface, borderRadius: BorderRadius.circular(14),
                border: Border.all(color: T.border, width: 0.5),
              ),
              child: Column(children: [
                Row(children: [
                  Container(
                    width: 28, height: 28, alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: i < 3 ? T.accent.withValues(alpha: 0.12) : T.surfaceLight,
                      borderRadius: BorderRadius.circular(7),
                    ),
                    child: Text('${i + 1}', style: TextStyle(
                      fontSize: 11, fontWeight: FontWeight.bold,
                      color: i < 3 ? T.accent : T.muted)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(d['name']?.toString() ?? '—',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: T.text))),
                  Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text('${fmtNum(qty)} шт', style: const TextStyle(fontSize: 12, color: T.muted)),
                    Text('${fmtNum(rev, compact: true)} UZS',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: T.text)),
                  ]),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    decoration: BoxDecoration(
                      color: T.accent.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(6)),
                    child: Text('$share%',
                      style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: T.accent)),
                  ),
                ]),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: maxQty > 0 ? qty / maxQty : 0,
                    backgroundColor: T.surfaceLight,
                    color: i == 0 ? T.accent : T.accentDark,
                    minHeight: 3,
                  ),
                ),
              ]),
            );
          },
        ),
      ),
    );
  }
}

// ── Waiters tab ───────────────────────────────────────────────────────────────

class _WaitersTab extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  final double total;
  final Future<void> Function() onRefresh;
  const _WaitersTab({required this.items, required this.total, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const EmptyState(icon: Icons.people_outline, message: 'Нет данных по официантам');
    }
    return RefreshIndicator(
      color: T.accent,
      onRefresh: onRefresh,
      child: ResponsiveBox(
        child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: items.length,
          itemBuilder: (_, i) {
            final w = items[i];
            final orders = toInt(w['orders_count'] ?? w['orders']);
            final rev    = toDouble(w['total'] ?? w['revenue']);
            final avg    = orders > 0 ? rev / orders : 0.0;
            final share  = total > 0 ? (rev / total * 100).toStringAsFixed(1) : '0';
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: T.surface, borderRadius: BorderRadius.circular(14),
                border: Border.all(color: T.border, width: 0.5),
              ),
              child: Row(children: [
                Container(
                  width: 42, height: 42, alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: T.purple.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text('${i + 1}', style: const TextStyle(
                    fontSize: 15, fontWeight: FontWeight.bold, color: T.purple)),
                ),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(w['name']?.toString() ?? '—',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: T.text)),
                  const SizedBox(height: 3),
                  Text('$orders заказов · ср. ${fmtNum(avg, compact: true)} UZS',
                    style: const TextStyle(fontSize: 12, color: T.muted)),
                ])),
                Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                  Text('${fmtNum(rev, compact: true)} UZS',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: T.text)),
                  const SizedBox(height: 3),
                  Text('$share%', style: const TextStyle(fontSize: 12, color: T.accent, fontWeight: FontWeight.w600)),
                ]),
              ]),
            );
          },
        ),
      ),
    );
  }
}

// ── Cancelled tab ─────────────────────────────────────────────────────────────

class _CancelledTab extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  final int count;
  final Future<void> Function() onRefresh;
  const _CancelledTab({required this.items, required this.count, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const EmptyState(icon: Icons.check_circle_outline, message: 'Нет отменённых заказов');
    }
    return RefreshIndicator(
      color: T.accent,
      onRefresh: onRefresh,
      child: ResponsiveBox(
        child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          itemCount: items.length,
          itemBuilder: (_, i) {
            final o = items[i];
            final orderNum = o['order_number']?.toString() ?? '—';
            final reason   = o['cancel_reason']?.toString() ?? o['reason']?.toString() ?? '';
            final total    = toDouble(o['total'] ?? o['total_amount']);
            final date     = fmtDateTime(o['created_at']?.toString() ?? o['cancelled_at']?.toString());
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: T.surface, borderRadius: BorderRadius.circular(14),
                border: Border.all(color: T.border, width: 0.5),
              ),
              child: Row(children: [
                Container(
                  width: 36, height: 36, alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: T.danger.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10)),
                  child: const Icon(Icons.cancel_outlined, color: T.danger, size: 18),
                ),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('#$orderNum',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: T.text)),
                  if (reason.isNotEmpty)
                    Text(reason, style: const TextStyle(fontSize: 12, color: T.muted),
                      maxLines: 1, overflow: TextOverflow.ellipsis),
                  Text(date, style: const TextStyle(fontSize: 11, color: T.muted)),
                ])),
                Text('${fmtNum(total, compact: true)} UZS',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: T.danger)),
              ]),
            );
          },
        ),
      ),
    );
  }
}
