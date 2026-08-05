import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api.dart';

typedef WsHandler = void Function(Map<String, dynamic> data);

/// Singleton WebSocket client for `/ws/kitchen`.
///
/// Usage:
///   WsService().connect(branchId);
///   final cancel = WsService().on('new_order', (data) { ... });
///   cancel(); // unsubscribe
///   WsService().disconnect(); // call on logout / mode exit
class WsService {
  static final WsService _i = WsService._();
  factory WsService() => _i;
  WsService._();

  WebSocket? _ws;
  StreamSubscription? _sub;
  Timer? _reconnectTimer;
  Timer? _pingTimer;

  String? _branchId;
  String? _localIp;         // set when using local desktop WS
  String? _localToken;      // pairing token required by the desktop proxy
  bool _active = false;
  int _retryDelay = 1;

  bool _connected = false;
  bool get isConnected => _connected;

  final _handlers = <String, List<WsHandler>>{};

  /// Subscribe to [event]. Returns a cancel callback.
  VoidCallback on(String event, WsHandler handler) {
    _handlers.putIfAbsent(event, () => []).add(handler);
    return () => _handlers[event]?.remove(handler);
  }

  Future<void> connect(String branchId) async {
    if (_active && _branchId == branchId && _connected) return;
    _branchId = branchId;
    _active = true;
    _retryDelay = 1;
    // Cache local IP so reconnect timer doesn't need to re-read prefs
    final prefs = await SharedPreferences.getInstance();
    final localIpPref = prefs.getString('local_desktop_ip')?.trim() ?? '';
    _localIp = localIpPref.isNotEmpty ? localIpPref : null;
    _localToken = prefs.getString('local_desktop_token')?.trim();
    _cleanup();
    await _doConnect();
  }

  Future<void> _doConnect() async {
    if (!_active) return;

    try {
      final String uri;
      if (_localIp != null) {
        // Local mode: connect to the desktop's LAN proxy, pairing token required
        final token = _localToken;
        uri = (token != null && token.isNotEmpty)
            ? 'ws://$_localIp:8765?token=$token'
            : 'ws://$_localIp:8765';
      } else {
        if (_branchId == null) return;
        final prefs = await SharedPreferences.getInstance();
        final baseUrl = prefs.getString('server_url') ?? 'http://localhost:8000/api/v1';
        final token = Api().token;
        if (token == null) { _scheduleReconnect(); return; }
        final wsBase = baseUrl
            .replaceFirst(RegExp(r'^https://'), 'wss://')
            .replaceFirst(RegExp(r'^http://'), 'ws://')
            .replaceAll(RegExp(r'/api/v1/?$'), '');
        uri = '$wsBase/ws/kitchen?token=$token&branch_id=$_branchId';
      }

      _ws = await WebSocket.connect(uri).timeout(const Duration(seconds: 8));

      _connected = true;
      _retryDelay = 1;
      _startPing();
      _dispatch('__connected__', {});

      _sub = _ws!.listen(
        _onMessage,
        onDone: _onDrop,
        onError: (_) => _onDrop(),
        cancelOnError: true,
      );
    } catch (_) {
      _connected = false;
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic raw) {
    if (raw == 'pong') return;
    try {
      final data = jsonDecode(raw as String) as Map<String, dynamic>;
      final event = data['event'] as String? ?? data['type'] as String?;
      if (event == null) return;
      final payload = data['data'] is Map<String, dynamic>
          ? data['data'] as Map<String, dynamic>
          : data;
      _dispatch(event, payload);
      _dispatch('*', payload);
    } catch (_) {}
  }

  void _dispatch(String event, Map<String, dynamic> payload) {
    for (final h in List.of(_handlers[event] ?? [])) {
      h(payload);
    }
  }

  void _onDrop() {
    _connected = false;
    _pingTimer?.cancel();
    _pingTimer = null;
    _ws = null;
    _dispatch('__disconnected__', {});
    if (_active) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: _retryDelay), _doConnect);
    _retryDelay = (_retryDelay * 2).clamp(1, 30);
  }

  void _startPing() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      try { _ws?.add('ping'); } catch (_) {}
    });
  }

  void _cleanup() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _sub?.cancel();
    _sub = null;
    try { _ws?.close(); } catch (_) {}
    _ws = null;
    _connected = false;
  }

  void disconnect() {
    _active = false;
    _cleanup();
  }
}
