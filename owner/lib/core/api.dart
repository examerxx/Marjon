import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Typed exception thrown by every Api call on non-2xx responses.
/// Callers can catch [ApiException] to distinguish network/auth errors
/// from unexpected failures without swallowing them silently.
class ApiException implements Exception {
  final int? statusCode;
  final String message;
  ApiException(this.message, {this.statusCode});

  @override
  String toString() => statusCode != null
      ? 'ApiException($statusCode): $message'
      : 'ApiException: $message';

  static ApiException fromDio(DioException e) {
    final code = e.response?.statusCode;
    final body = e.response?.data;
    final detail = body is Map ? (body['detail'] ?? body['message']) : null;
    return ApiException(
      detail?.toString() ?? e.message ?? 'Ошибка сети',
      statusCode: code,
    );
  }
}

class Api {
  static final Api _i = Api._();
  factory Api() => _i;

  late final Dio dio;
  String? _token;

  Api._() {
    dio = Dio(BaseOptions(connectTimeout: const Duration(seconds: 12)));
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (o, h) async {
        final prefs = await SharedPreferences.getInstance();
        o.baseUrl = prefs.getString('server_url') ?? 'http://localhost:8000/api/v1';
        if (_token != null) o.headers['Authorization'] = 'Bearer $_token';
        h.next(o);
      },
      onError: (e, h) async {
        if (e.response?.statusCode == 401) {
          _token = null;
          final prefs = await SharedPreferences.getInstance();
          await prefs.remove('token');
        }
        h.reject(
          DioException(
            requestOptions: e.requestOptions,
            response: e.response,
            type: e.type,
            error: ApiException.fromDio(e),
            message: ApiException.fromDio(e).message,
          ),
        );
      },
    ));
  }

  void setToken(String? t) => _token = t;

  // ── Auth ──────────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> login(String login, String password) async =>
    (await dio.post('/auth/login', data: {'phone': login, 'password': password})).data;

  Future<Map<String, dynamic>> me() async => (await dio.get('/auth/me')).data;

  Future<List<dynamic>> listUsers() async => (await dio.get('/auth/users')).data;

  Future<Map<String, dynamic>> createUser(Map<String, dynamic> data) async =>
    (await dio.post('/auth/users', data: data)).data;

  Future<void> updateUser(String id, Map<String, dynamic> data) async =>
    await dio.patch('/auth/users/$id', data: data);

  Future<void> deleteUser(String id) async => await dio.delete('/auth/users/$id');

  // ── Company & Branches ────────────────────────────────────────────────────
  Future<Map<String, dynamic>> company() async => (await dio.get('/companies/me')).data;

  Future<Map<String, dynamic>> updateCompany(Map<String, dynamic> data) async =>
    (await dio.patch('/companies/me', data: data)).data;

  Future<List<dynamic>> branches() async => (await dio.get('/companies/me/branches')).data;

  Future<Map<String, dynamic>> createBranch(Map<String, dynamic> data) async =>
    (await dio.post('/companies/me/branches', data: data)).data;

  Future<Map<String, dynamic>> updateBranch(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/companies/me/branches/$id', data: data)).data;

  // ── HR Employees ──────────────────────────────────────────────────────────
  Future<List<dynamic>> employees() async => (await dio.get('/hr/employees')).data;

  Future<Map<String, dynamic>> createEmployee(Map<String, dynamic> data) async =>
    (await dio.post('/hr/employees', data: data)).data;

  Future<Map<String, dynamic>> updateEmployee(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/hr/employees/$id', data: data)).data;

  Future<void> deleteEmployee(String id) async => await dio.delete('/hr/employees/$id');

  // ── Inventory: Categories ─────────────────────────────────────────────────
  Future<List<dynamic>> categories() async => (await dio.get('/inventory/categories')).data;

  Future<Map<String, dynamic>> createCategory(Map<String, dynamic> data) async =>
    (await dio.post('/inventory/categories', data: data)).data;

  Future<Map<String, dynamic>> updateCategory(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/inventory/categories/$id', data: data)).data;

  Future<void> deleteCategory(String id) async => await dio.delete('/inventory/categories/$id');

  // ── Inventory: Products ───────────────────────────────────────────────────
  Future<List<dynamic>> products() async =>
    (await dio.get('/inventory/products', queryParameters: {'include_all': true})).data;

  Future<Map<String, dynamic>> createProduct(Map<String, dynamic> data) async =>
    (await dio.post('/inventory/products', data: data)).data;

  Future<Map<String, dynamic>> updateProduct(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/inventory/products/$id', data: data)).data;

  Future<void> deleteProduct(String id) async => await dio.delete('/inventory/products/$id');

  /// Upload image to storage and return the public URL string.
  Future<String> uploadImage(List<int> bytes, String filename) async {
    final safeFilename = filename.replaceAll(RegExp(r'\.(heic|heif)$', caseSensitive: false), '.jpg');
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: safeFilename),
    });
    final res = (await dio.post('/inventory/upload-image', data: form)).data;
    return res['url'] as String;
  }

  Future<Map<String, dynamic>> uploadProductPhoto(String id, List<int> bytes, String filename) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    return (await dio.post('/inventory/products/$id/photo', data: form)).data;
  }

  Future<Map<String, dynamic>> uploadProfilePhoto(List<int> bytes, String filename) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    return (await dio.post('/auth/me/photo', data: form)).data;
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  Future<List<dynamic>> orders({String? branchId, String? status, String? date}) async {
    final p = <String, dynamic>{};
    if (branchId != null) p['branch_id'] = branchId;
    if (status != null) p['status'] = status;
    if (date != null) p['date'] = date;
    return (await dio.get('/pos/orders', queryParameters: p)).data;
  }

  // ── Halls & Tables ────────────────────────────────────────────────────────
  Future<List<dynamic>> halls({String? branchId}) async {
    final p = <String, dynamic>{};
    if (branchId != null) p['branch_id'] = branchId;
    return (await dio.get('/halls', queryParameters: p)).data;
  }

  Future<Map<String, dynamic>> createHall(Map<String, dynamic> data) async =>
    (await dio.post('/halls', data: data)).data;

  Future<Map<String, dynamic>> updateHall(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/halls/$id', data: data)).data;

  Future<void> deleteHall(String id) async => await dio.delete('/halls/$id');

  Future<List<dynamic>> hallTables(String hallId) async =>
    (await dio.get('/halls/$hallId/tables')).data;

  Future<Map<String, dynamic>> createTable(String hallId, Map<String, dynamic> data) async =>
    (await dio.post('/halls/$hallId/tables', data: data)).data;

  Future<void> deleteTable(String hallId, String tableId) async =>
    await dio.delete('/halls/$hallId/tables/$tableId');

  Future<List<dynamic>> branchTables(String branchId) async =>
    (await dio.get('/halls/branch/$branchId/tables')).data;

  // ── Finance ───────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> financeTransactions({
    String? dateFrom, String? dateTo, String? direction,
  }) async {
    final p = <String, dynamic>{};
    if (dateFrom != null) p['date_from'] = dateFrom;
    if (dateTo != null) p['date_to'] = dateTo;
    if (direction != null) p['direction'] = direction;
    return (await dio.get('/finance/transactions', queryParameters: p)).data;
  }

  Future<Map<String, dynamic>> createTransaction(Map<String, dynamic> data) async =>
    (await dio.post('/finance/transactions', data: data)).data;

  Future<Map<String, dynamic>> updateTransaction(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/finance/transactions/$id', data: data)).data;

  Future<Map<String, dynamic>> transactionCategories({String? kind}) async {
    final p = <String, dynamic>{};
    if (kind != null) p['kind'] = kind;
    return (await dio.get('/finance/transaction-categories', queryParameters: p)).data;
  }

  Future<Map<String, dynamic>> createTransactionCategory(Map<String, dynamic> data) async =>
    (await dio.post('/finance/transaction-categories', data: data)).data;

  Future<List<dynamic>> paymentTypes() async =>
    (await dio.get('/finance/payment-types')).data;

  Future<Map<String, dynamic>> createPaymentType(Map<String, dynamic> data) async =>
    (await dio.post('/finance/payment-types', data: data)).data;

  Future<Map<String, dynamic>> updatePaymentType(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/finance/payment-types/$id', data: data)).data;

  Future<void> deletePaymentType(String id) async =>
    await dio.delete('/finance/payment-types/$id');

  // ── Reports ───────────────────────────────────────────────────────────────
  // Note: backend returns a plain list for these (admin_reports module — its
  // /reports/* routes are registered before kafe_compat's and shadow them).
  Future<List<dynamic>> reportOrders({String? dateFrom, String? dateTo}) async {
    final p = <String, dynamic>{};
    if (dateFrom != null) p['date_from'] = dateFrom;
    if (dateTo != null) p['date_to'] = dateTo;
    final r = (await dio.get('/reports/orders', queryParameters: p)).data;
    return r is List ? r : [];
  }

  Future<List<dynamic>> reportDishes({String? dateFrom, String? dateTo}) async {
    final p = <String, dynamic>{};
    if (dateFrom != null) p['date_from'] = dateFrom;
    if (dateTo != null) p['date_to'] = dateTo;
    final r = (await dio.get('/reports/dishes', queryParameters: p)).data;
    return r is List ? r : [];
  }

  Future<List<dynamic>> reportWaiters({String? dateFrom, String? dateTo}) async {
    final p = <String, dynamic>{};
    if (dateFrom != null) p['date_from'] = dateFrom;
    if (dateTo != null) p['date_to'] = dateTo;
    final r = (await dio.get('/reports/waiters', queryParameters: p)).data;
    return r is List ? r : [];
  }

  Future<List<dynamic>> reportCancelled({String? dateFrom, String? dateTo}) async {
    final p = <String, dynamic>{};
    if (dateFrom != null) p['date_from'] = dateFrom;
    if (dateTo != null) p['date_to'] = dateTo;
    final r = (await dio.get('/reports/cancelled', queryParameters: p)).data;
    return r is List ? r : [];
  }

  // ── Analytics ────────────────────────────────────────────────────────────
  Future<List<dynamic>> analyticsSales({String? dateFrom, String? dateTo}) async {
    final p = <String, dynamic>{};
    if (dateFrom != null) p['date_from'] = dateFrom;
    if (dateTo != null) p['date_to'] = dateTo;
    final r = (await dio.get('/analytics/sales', queryParameters: p)).data;
    if (r is! List) throw ApiException('Unexpected response format for analytics/sales');
    return r;
  }

  // ── Units ────────────────────────────────────────────────────────────────
  Future<List<dynamic>> units() async => (await dio.get('/units')).data;

  Future<Map<String, dynamic>> createUnit(Map<String, dynamic> data) async =>
    (await dio.post('/units', data: data)).data;

  Future<void> deleteUnit(String id) async => await dio.delete('/units/$id');

  // ── Printers ─────────────────────────────────────────────────────────────
  Future<List<dynamic>> printers() async => (await dio.get('/printers')).data;

  Future<Map<String, dynamic>> createPrinter(Map<String, dynamic> data) async =>
    (await dio.post('/printers', data: data)).data;

  Future<Map<String, dynamic>> updatePrinter(String id, Map<String, dynamic> data) async =>
    (await dio.patch('/printers/$id', data: data)).data;

  Future<void> deletePrinter(String id) async => await dio.delete('/printers/$id');

  Future<Map<String, dynamic>> pingPrinter(String ip, {int port = 9100}) async =>
    (await dio.get('/printers/ping', queryParameters: {'ip': ip, 'port': port})).data;

  // ── Payment Gateway Settings ──────────────────────────────────────────────
  Future<Map<String, dynamic>> gatewaySettings() async =>
    (await dio.get('/payments/gateway-settings')).data;

  Future<Map<String, dynamic>> saveGatewaySettings(Map<String, dynamic> data) async =>
    (await dio.put('/payments/gateway-settings', data: data)).data;

  // ── Billing ───────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> billing() async {
    try {
      return (await dio.get('/billing/balance')).data;
    } catch (_) {
      return {'balance': 0, 'currency': 'UZS', 'plan': 'Trial', 'days_left': 30};
    }
  }
}
