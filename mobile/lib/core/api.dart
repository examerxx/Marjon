import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

// ── Typed error ───────────────────────────────────────────────────────────────

class ApiException implements Exception {
  final int? statusCode;
  final String message;
  ApiException(this.message, {this.statusCode});

  @override
  String toString() => message;

  static ApiException fromDio(DioException e) {
    final code  = e.response?.statusCode;
    final body  = e.response?.data;
    final detail = body is Map ? (body['detail'] ?? body['message']) : null;
    return ApiException(
      detail?.toString() ?? e.message ?? 'Ошибка сети',
      statusCode: code,
    );
  }
}

// ── API singleton ─────────────────────────────────────────────────────────────

class Api {
  static final Api _instance = Api._();
  factory Api() => _instance;

  late final Dio dio;
  String? _token;

  Api._() {
    dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
    ));
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final prefs = await SharedPreferences.getInstance();
        final localIp = prefs.getString('local_desktop_ip')?.trim() ?? '';
        if (localIp.isNotEmpty) {
          // Route through the desktop's local REST proxy so mobile devices
          // on the LAN don't need direct internet/cloud access. The proxy
          // requires the pairing token shown on the desktop screen.
          options.baseUrl = 'http://$localIp:8765/api/v1';
          final localToken = prefs.getString('local_desktop_token')?.trim() ?? '';
          if (localToken.isNotEmpty) {
            options.headers['X-Local-Token'] = localToken;
          }
        } else {
          options.baseUrl = prefs.getString('server_url') ?? 'http://localhost:8000/api/v1';
        }
        if (_token != null) {
          options.headers['Authorization'] = 'Bearer $_token';
        }
        handler.next(options);
      },
      onError: (e, handler) async {
        if (e.response?.statusCode == 401) {
          _token = null;
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove('token');
        }
        handler.reject(DioException(
          requestOptions: e.requestOptions,
          response: e.response,
          type: e.type,
          error: ApiException.fromDio(e),
        ));
      },
    ));
  }

  void setToken(String? token) => _token = token;
  String? get token => _token;

  // ── Auth ──────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> login(String login, String password) async {
    final res = await dio.post('/auth/login', data: {'email': login, 'password': password});
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> me() async {
    final res = await dio.get('/auth/me');
    return res.data as Map<String, dynamic>;
  }

  // ── Branches ──────────────────────────────────────────────────────────────

  Future<List<dynamic>> branches() async {
    final res = await dio.get('/companies/me/branches');
    return res.data as List<dynamic>;
  }

  // ── Inventory ─────────────────────────────────────────────────────────────

  Future<List<dynamic>> categories() async {
    final res = await dio.get('/inventory/categories');
    return res.data as List<dynamic>;
  }

  Future<List<dynamic>> products() async {
    final res = await dio.get('/inventory/products');
    return res.data as List<dynamic>;
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  Future<List<dynamic>> orders({
    String? branchId,
    String? status,
    bool activeOnly = false,
    String? tableNumber,
    int limit = 200,
    int offset = 0,
  }) async {
    final params = <String, dynamic>{};
    if (branchId != null) params['branch_id'] = branchId;
    if (status != null) params['status'] = status;
    if (activeOnly) params['active_only'] = 'true';
    if (tableNumber != null) params['table_number'] = tableNumber;
    if (limit != 200) params['limit'] = limit;
    if (offset != 0) params['offset'] = offset;
    final res = await dio.get('/pos/orders', queryParameters: params);
    return res.data as List<dynamic>;
  }

  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> data) async {
    final res = await dio.post('/pos/orders', data: data);
    return res.data as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> updateOrderStatus(String orderId, String status) async {
    final res = await dio.patch('/pos/orders/$orderId/status', data: {'status': status});
    return res.data as Map<String, dynamic>;
  }

  // ── Kitchen ───────────────────────────────────────────────────────────────

  Future<List<dynamic>> kitchenOrders(String branchId) async {
    final res = await dio.get('/kitchen/orders', queryParameters: {'branch_id': branchId});
    return res.data as List<dynamic>;
  }

  Future<void> itemDone(String itemId) async {
    await dio.patch('/kitchen/orders/items/status', data: {
      'order_item_id': itemId,
      'status': 'ready',
    });
  }

  // ── Halls & Tables ────────────────────────────────────────────────────────

  Future<List<dynamic>> branchTables(String branchId) async {
    final res = await dio.get('/halls/branch/$branchId/tables');
    return res.data as List<dynamic>;
  }

  // ── Printers ─────────────────────────────────────────────────────────────

  Future<List<dynamic>> printers() async {
    final res = await dio.get('/printers');
    return res.data as List<dynamic>;
  }

  Future<void> printReceipt(String orderId, String printerId, {int copies = 1}) async {
    await dio.post('/printers/print/receipt', data: {
      'order_id': orderId,
      'printer_id': printerId,
      'copies': copies,
    });
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  Future<List<dynamic>> paymentTypes() async {
    final res = await dio.get('/finance/payment-types');
    return res.data as List<dynamic>;
  }

  Future<Map<String, dynamic>> processPayment({
    required String orderId,
    required double amount,
    required String method,
    double? cashReceived,
  }) async {
    final data = <String, dynamic>{
      'order_id': orderId,
      'amount': amount,
      'method': method,
      if (cashReceived != null) 'cash_received': cashReceived,
    };
    final res = await dio.post('/payments', data: data);
    return res.data as Map<String, dynamic>;
  }
}
