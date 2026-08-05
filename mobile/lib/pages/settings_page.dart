import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/app_state.dart';
import '../core/theme.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  String _lang = 'ru';
  String _localDesktopIp = '';
  String _localDesktopToken = '';

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() {
        _lang              = prefs.getString('lang') ?? 'ru';
        _localDesktopIp    = prefs.getString('local_desktop_ip') ?? '';
        _localDesktopToken = prefs.getString('local_desktop_token') ?? '';
      });
    }
  }

  Future<void> _setLang(String lang) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lang', lang);
    if (mounted) setState(() => _lang = lang);
  }

  Future<void> _editLocalDesktopIp() async {
    final ipCtrl    = TextEditingController(text: _localDesktopIp);
    final tokenCtrl = TextEditingController(text: _localDesktopToken);
    final result = await showDialog<(String, String)>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Подключение к десктопу'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text(
            'Введите локальный IP десктопного терминала и код подключения '
            '(показан на экране десктопа справа внизу).\n'
            'Оставьте пустым — будет использоваться облачный сервер.',
            style: TextStyle(fontSize: 13),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: ipCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              hintText: '192.168.x.x',
              prefixText: 'ws://',
              suffixText: ':8765',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: tokenCtrl,
            decoration: const InputDecoration(
              labelText: 'Код подключения',
              hintText: 'например a1b2c3...',
            ),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Отмена')),
          TextButton(
            onPressed: () => Navigator.pop(context, (ipCtrl.text.trim(), tokenCtrl.text.trim())),
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
    if (result == null || !mounted) return;
    final (ip, token) = result;
    final prefs = await SharedPreferences.getInstance();
    if (ip.isEmpty) {
      await prefs.remove('local_desktop_ip');
      await prefs.remove('local_desktop_token');
    } else {
      await prefs.setString('local_desktop_ip', ip);
      await prefs.setString('local_desktop_token', token);
    }
    setState(() { _localDesktopIp = ip; _localDesktopToken = token; });
  }

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Настройки')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Profile
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppTheme.border, width: 0.5),
            ),
            child: Row(children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: AppTheme.accent,
                child: Text(
                  (state.displayName.isNotEmpty
                    ? state.displayName[0] : '?').toUpperCase(),
                  style: const TextStyle(
                    fontSize: 24, fontWeight: FontWeight.bold, color: Colors.white),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(state.displayName,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(state.user?['email'] ?? '',
                  style: const TextStyle(color: AppTheme.textMuted, fontSize: 13)),
                const SizedBox(height: 2),
                Text(state.roles.join(', '),
                  style: const TextStyle(color: AppTheme.accent, fontSize: 13)),
              ])),
            ]),
          ),
          const SizedBox(height: 20),

          _sectionTitle('Язык'),
          _radioTile('Русский', 'ru'),
          _radioTile("O'zbekcha", 'uz'),
          _radioTile('English', 'en'),

          const SizedBox(height: 20),
          _sectionTitle('Подключение'),
          Container(
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border, width: 0.5),
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Филиал',
                    style: TextStyle(color: AppTheme.textMuted, fontSize: 13)),
                  const SizedBox(height: 4),
                  Text(state.branch?['name'] ?? 'Не выбран',
                    style: const TextStyle(fontSize: 14)),
                  const SizedBox(height: 14),
                  const Divider(height: 0),
                ]),
              ),
              ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
                leading: Icon(
                  Icons.wifi,
                  color: _localDesktopIp.isNotEmpty
                      ? AppTheme.accent : AppTheme.textMuted),
                title: const Text('Локальный десктоп (LAN)',
                  style: TextStyle(fontSize: 14)),
                subtitle: Text(
                  _localDesktopIp.isNotEmpty
                      ? 'ws://$_localDesktopIp:8765'
                      : 'Не настроен — используется облако',
                  style: const TextStyle(fontSize: 12)),
                trailing: const Icon(Icons.edit_outlined,
                  size: 18, color: AppTheme.textMuted),
                onTap: _editLocalDesktopIp,
              ),
            ]),
          ),

          const SizedBox(height: 20),
          _sectionTitle('Приложение'),
          Container(
            decoration: BoxDecoration(
              color: AppTheme.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppTheme.border, width: 0.5),
            ),
            child: Column(children: [
              ListTile(
                leading: const Icon(Icons.info_outline, color: AppTheme.textMuted),
                title: const Text('Версия'),
                trailing: const Text('1.0.0',
                  style: TextStyle(color: AppTheme.textMuted)),
              ),
              const Divider(height: 0, indent: 16, endIndent: 16),
              ListTile(
                leading: const Icon(Icons.swap_horiz, color: AppTheme.textMuted),
                title: const Text('Сменить филиал'),
                trailing: const Icon(Icons.chevron_right, color: AppTheme.textMuted),
                onTap: () => state.backToBranch(),
              ),
              const Divider(height: 0, indent: 16, endIndent: 16),
              ListTile(
                leading: const Icon(Icons.privacy_tip_outlined, color: AppTheme.textMuted),
                title: const Text('Конфиденциальность'),
                trailing: const Icon(Icons.chevron_right, color: AppTheme.textMuted),
                onTap: () => context.push('/privacy'),
              ),
            ]),
          ),

          const SizedBox(height: 24),
          SizedBox(width: double.infinity, child: OutlinedButton.icon(
            icon: const Icon(Icons.logout, color: AppTheme.danger),
            label: const Text('Выйти',
              style: TextStyle(color: AppTheme.danger)),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: AppTheme.danger)),
            onPressed: () => state.logout(),
          )),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  Widget _sectionTitle(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 8, left: 4),
    child: Text(text, style: const TextStyle(
      fontSize: 14, fontWeight: FontWeight.w600,
      color: AppTheme.textMuted, letterSpacing: 0.5)),
  );

  Widget _radioTile(String label, String value) {
    final selected = _lang == value;
    return GestureDetector(
      onTap: () => _setLang(value),
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: selected
            ? AppTheme.accent.withValues(alpha: 0.1)
            : AppTheme.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected ? AppTheme.accent : AppTheme.border,
            width: selected ? 1.5 : 0.5),
        ),
        child: Row(children: [
          Icon(
            selected ? Icons.radio_button_checked : Icons.radio_button_off,
            color: selected ? AppTheme.accent : AppTheme.textMuted, size: 20),
          const SizedBox(width: 12),
          Text(label, style: TextStyle(
            fontSize: 15,
            color: selected ? AppTheme.accent : AppTheme.textColor)),
        ]),
      ),
    );
  }
}
