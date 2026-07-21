import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/app_state.dart';
import '../core/theme.dart';
import '../view_models/kitchen_view_model.dart';
import '../widgets/common.dart';

class KitchenPage extends StatefulWidget {
  final String title;
  final Color accentColor;
  const KitchenPage({
    super.key,
    this.title = 'Кухня',
    this.accentColor = AppTheme.danger,
  });
  @override
  State<KitchenPage> createState() => _KitchenPageState();
}

class _KitchenPageState extends State<KitchenPage> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final branchId = context.read<AppState>().branchId;
      context.read<KitchenViewModel>().start(branchId);
    });
  }

  Future<void> _acceptOrder(String orderId) async {
    final ok = await context.read<KitchenViewModel>().acceptOrder(orderId);
    if (!ok && mounted) showSnack(context, 'Ошибка', error: true);
  }

  Future<void> _markItemReady(String itemId) async {
    final ok = await context.read<KitchenViewModel>().markItemReady(itemId);
    if (!ok && mounted) showSnack(context, 'Ошибка', error: true);
  }

  Future<void> _markOrderReady(Map<String, dynamic> order) async {
    final ok = await context
        .read<KitchenViewModel>()
        .markOrderReady(order['id'] as String);
    if (!mounted) return;
    if (ok) {
      showSnack(context, 'Заказ #${order['order_number']} готов!');
    } else {
      showSnack(context, 'Ошибка', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final vm    = context.watch<KitchenViewModel>();
    return Scaffold(
      backgroundColor: AppTheme.bg,
      appBar: AppBar(
        backgroundColor: AppTheme.surface,
        leading: state.isAdmin
          ? IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: state.backToModes)
          : null,
        title: Text(widget.title),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 8),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: widget.accentColor,
              borderRadius: BorderRadius.circular(4)),
            child: Text('${vm.orders.length}',
              style: const TextStyle(
                fontWeight: FontWeight.bold, fontSize: 15)),
          ),
          const LivePulse(),
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push('/settings'),
          ),
        ],
      ),
      body: AnimatedSwitcher(
        duration: const Duration(milliseconds: 250),
        child: vm.loading
          ? const LoadingCenter(key: ValueKey('loading'))
          : RefreshIndicator(
              key: const ValueKey('list'),
              onRefresh: vm.load,
              child: vm.orders.isEmpty
                ? const EmptyState(
                    icon: Icons.soup_kitchen_outlined,
                    message: 'Нет заказов')
                : ListView.builder(
                    padding: EdgeInsets.fromLTRB(
                      10, 10, 10, MediaQuery.of(context).padding.bottom + 10),
                    itemCount: vm.orders.length,
                    itemBuilder: (ctx, i) => _buildOrderCard(vm.orders[i]),
                  ),
            ),
      ),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final items         = order['items'] as List? ?? [];
    final status        = order['status'] as String;
    final allItemsReady = items.isNotEmpty &&
        items.every((it) => it['status'] == 'ready');
    final notStarted = status == 'new' || status == 'accepted';
    final canSwipe = notStarted || (status == 'cooking' && allItemsReady);

    return Dismissible(
      key: ValueKey('k_${order['id']}_$status'),
      direction: canSwipe ? DismissDirection.startToEnd : DismissDirection.none,
      background: Container(
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.symmetric(horizontal: 24),
        decoration: BoxDecoration(
          color: notStarted ? AppTheme.accent : AppTheme.success,
          borderRadius: BorderRadius.circular(12)),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(
            notStarted ? Icons.restaurant : Icons.check_circle_outline,
            color: Colors.white, size: 34),
          const SizedBox(height: 6),
          Text(
            notStarted ? 'Начать готовить' : 'Заказ готов!',
            style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
        ]),
      ),
      confirmDismiss: (_) async {
        if (notStarted) {
          await _acceptOrder(order['id'] as String);
        } else if (allItemsReady) {
          await _markOrderReady(order);
        }
        return false;
      },
      child: Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        border: Border.all(
          color: notStarted
            ? AppTheme.accentLight
            : allItemsReady
              ? AppTheme.success
              : widget.accentColor.withValues(alpha: 0.4),
          width: 2,
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('#${order['order_number']}',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          if (order['table_number'] != null) ...[
            const SizedBox(width: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppTheme.surfaceLight,
                borderRadius: BorderRadius.circular(4)),
              child: Text('Стол ${order['table_number']}',
                style: const TextStyle(fontSize: 14)),
            ),
          ],
          const Spacer(),
          Icon(Icons.access_time, size: 16,
            color: waitColor(order['created_at'] as String?)),
          const SizedBox(width: 4),
          Text(waitTime(order['created_at'] as String?),
            style: TextStyle(
              color: waitColor(order['created_at'] as String?),
              fontWeight: FontWeight.w600, fontSize: 14)),
        ]),
        if (order['note'] != null) ...[
          const SizedBox(height: 6),
          Text(order['note'] as String,
            style: const TextStyle(color: AppTheme.warning, fontSize: 14)),
        ],
        const SizedBox(height: 10),
        ...items.map((item) => _buildItemRow(item as Map<String, dynamic>, status)),
        const SizedBox(height: 10),
        if (notStarted)
          SizedBox(width: double.infinity, child: ElevatedButton.icon(
            icon: const Icon(Icons.restaurant, size: 18),
            label: const Text('Начать готовить',
              style: TextStyle(fontSize: 16)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.accent,
              padding: const EdgeInsets.symmetric(vertical: 14)),
            onPressed: () => _acceptOrder(order['id'] as String),
          )),
        if (status == 'cooking' && allItemsReady)
          SizedBox(width: double.infinity, child: ElevatedButton.icon(
            icon: const Icon(Icons.check_circle, size: 20),
            label: const Text('Заказ готов!',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.success,
              padding: const EdgeInsets.symmetric(vertical: 14)),
            onPressed: () => _markOrderReady(order),
          )),
      ]),
      ),
    );
  }

  Widget _buildItemRow(Map<String, dynamic> item, String orderStatus) {
    final done = item['status'] == 'ready';
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: done ? const Color(0xFF082514) : AppTheme.surfaceLight,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(children: [
        Container(
          width: 36, height: 36,
          decoration: BoxDecoration(
            color: done
              ? AppTheme.success.withValues(alpha: 0.2)
              : AppTheme.danger.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(8)),
          alignment: Alignment.center,
          child: Text('${item['quantity']}', style: TextStyle(
            fontWeight: FontWeight.bold, fontSize: 16,
            color: done ? AppTheme.success : AppTheme.danger)),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,
          children: [
          Text(item['name'] as String, style: TextStyle(
            fontSize: 16, fontWeight: FontWeight.w500,
            decoration: done ? TextDecoration.lineThrough : null,
            color: done ? AppTheme.textMuted : AppTheme.textColor)),
          if (item['note'] != null)
            Text(item['note'] as String,
              style: const TextStyle(color: AppTheme.warning, fontSize: 12)),
        ])),
        if (!done && orderStatus == 'cooking')
          SizedBox(
            height: 36,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.success,
                padding: const EdgeInsets.symmetric(horizontal: 16)),
              onPressed: () => _markItemReady(item['id'] as String),
              child: const Text('Готово'),
            ),
          ),
        if (done)
          const Icon(Icons.check_circle, color: AppTheme.success, size: 28),
      ]),
    );
  }
}
