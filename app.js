// depo_automation_app.dart
// Tek dosyalık (single-file) Flutter uygulaması — Depo Otomasyonu MVP
// Notlar:
// - Bu dosya tek başına derlenebilir yapıdadır. Harici dosya gerektirmez.
// - Firebase/Mikro/REST entegrasyonları için yerler TODO ile işaretlendi.
// - Ekranlar: Giriş, Rol Seçimi (demo), Yönetici Paneli, Toplayıcı, Kontrol (QC), Arşiv, Ek Depo, Ayarlar.
// - Durum yönetimi: ChangeNotifier tabanlı basit AppState.
// - Veri: In-memory mock. Sonraki aşamada gerçek servis ile değiştirilebilir.
//
// Çalıştırmak için:
//   lib/main.dart içine bu içeriği koyabilir veya doğrudan bu dosyayı main.dart olarak kullanabilirsiniz.

import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

// ========================= MODELLER =========================

enum UserRole { manager, picker, qc }

enum OrderStatus { created, assigned, picking, picked, qc, completed, archived }

class OrderItem {
  final String id;
  final String code; // ürün kodu
  final String name; // ürün adı
  final String aisle; // reyon/raf
  int quantity; // istenen miktar
  int picked; // toplanan miktar
  String? note;

  OrderItem({
    required this.id,
    required this.code,
    required this.name,
    required this.aisle,
    required this.quantity,
    this.picked = 0,
    this.note,
  });
}

class OrderModel {
  final String id;
  final String branch; // şube adı
  final DateTime createdAt;
  OrderStatus status;
  String? assignedTo; // picker userId
  String? qcBy; // qc userId
  final List<OrderItem> items;

  OrderModel({
    required this.id,
    required this.branch,
    required this.createdAt,
    required this.items,
    this.status = OrderStatus.created,
    this.assignedTo,
    this.qcBy,
  });

  int get totalLines => items.length;
  int get totalQty => items.fold(0, (s, i) => s + i.quantity);
  int get totalPicked => items.fold(0, (s, i) => s + i.picked);
  bool get isFullyPicked => items.every((i) => i.picked >= i.quantity);
}

class UserModel {
  final String id;
  final String displayName;
  UserRole role;

  UserModel({required this.id, required this.displayName, required this.role});
}

// ========================= DURUM (STATE) =========================

class AppState extends ChangeNotifier {
  UserModel? currentUser;
  final List<OrderModel> _orders = _seedOrders();
  final List<OrderModel> _archived = [];
  final List<OrderItem> _additionDepot = []; // eksikler deposu (Ek Depo)

  // --- Authentication (Mock) ---
  Future<void> signInDemo(String name, UserRole role) async {
    currentUser = UserModel(id: 'u_${DateTime.now().millisecondsSinceEpoch}', displayName: name, role: role);
    notifyListeners();
  }

  void signOut() {
    currentUser = null;
    notifyListeners();
  }

  // --- Orders API (Mock) ---
  List<OrderModel> get allOrders => List.unmodifiable(_orders);
  List<OrderModel> get archived => List.unmodifiable(_archived);
  List<OrderItem> get additionDepot => List.unmodifiable(_additionDepot);

  List<OrderModel> ordersForRole(UserRole role) {
    if (role == UserRole.manager) return _orders.where((o) => o.status != OrderStatus.archived).toList();
    if (role == UserRole.picker) {
      return _orders.where((o) => o.status == OrderStatus.assigned || o.status == OrderStatus.picking).toList();
    }
    // QC
    return _orders.where((o) => o.status == OrderStatus.picked || o.status == OrderStatus.qc).toList();
  }

  void assignOrder(String orderId, String userId) {
    final o = _orders.firstWhere((e) => e.id == orderId);
    o.assignedTo = userId;
    o.status = OrderStatus.assigned;
    notifyListeners();
  }

  void startPicking(String orderId) {
    final o = _orders.firstWhere((e) => e.id == orderId);
    o.status = OrderStatus.picking;
    notifyListeners();
  }

  void updatePicked(String orderId, String itemId, int picked) {
    final o = _orders.firstWhere((e) => e.id == orderId);
    final it = o.items.firstWhere((i) => i.id == itemId);
    it.picked = picked.clamp(0, it.quantity);
    if (o.isFullyPicked) {
      o.status = OrderStatus.picked;
    }
    notifyListeners();
  }

  void markMissing(String orderId, String itemId, int missingQty, {String? note}) {
    final o = _orders.firstWhere((e) => e.id == orderId);
    final it = o.items.firstWhere((i) => i.id == itemId);
    final m = missingQty.clamp(0, it.quantity - it.picked);
    if (m > 0) {
      _additionDepot.add(OrderItem(
        id: 'miss_${o.id}_$itemId',
        code: it.code,
        name: it.name,
        aisle: it.aisle,
        quantity: m,
        note: note ?? 'Eksik (sipariş: ${o.id})',
      ));
    }
    notifyListeners();
  }

  void sendToQC(String orderId) {
    final o = _orders.firstWhere((e) => e.id == orderId);
    o.status = OrderStatus.picked;
    notifyListeners();
  }

  void qcApprove(String orderId, {String? qcUserId}) {
    final o = _orders.firstWhere((e) => e.id == orderId);
    o.qcBy = qcUserId;
    o.status = OrderStatus.completed;
    notifyListeners();
  }

  void archiveOrder(String orderId) {
    final idx = _orders.indexWhere((e) => e.id == orderId);
    if (idx == -1) return;
    final o = _orders.removeAt(idx);
    o.status = OrderStatus.archived;
    _archived.insert(0, o);
    notifyListeners();
  }

  void moveFromAdditionDepotToControl(String itemId) {
    final idx = _additionDepot.indexWhere((e) => e.id == itemId);
    if (idx == -1) return;
    _additionDepot.removeAt(idx);
    // TODO: Yönetici kontrol listesine ekleme akışı istenirse burada tasarlanabilir.
    notifyListeners();
  }

  // --- Arama/Filtre ---
  List<OrderModel> searchOrders(String query) {
    final q = query.toLowerCase();
    return _orders.where((o) =>
        o.id.toLowerCase().contains(q) ||
        o.branch.toLowerCase().contains(q) ||
        o.items.any((i) => i.name.toLowerCase().contains(q) || i.code.toLowerCase().contains(q))
    ).toList();
  }
}

List<OrderModel> _seedOrders() {
  return [
    OrderModel(
      id: 'SIP-10045',
      branch: 'Konyaaltı',
      createdAt: DateTime.now().subtract(const Duration(minutes: 45)),
      items: [
        OrderItem(id: 'i1', code: 'KJU-250', name: 'Kaju 250g', aisle: 'A-03', quantity: 12),
        OrderItem(id: 'i2', code: 'BDM-500', name: 'Badem 500g', aisle: 'A-01', quantity: 8),
        OrderItem(id: 'i3', code: 'FST-180', name: 'Fıstık 180g', aisle: 'B-02', quantity: 15),
      ],
    ),
    OrderModel(
      id: 'SIP-10046',
      branch: 'Kepez',
      createdAt: DateTime.now().subtract(const Duration(hours: 1, minutes: 15)),
      items: [
        OrderItem(id: 'i1', code: 'CIG-001', name: 'Çiğ Fındık 1kg', aisle: 'C-04', quantity: 4),
        OrderItem(id: 'i2', code: 'KRM-450', name: 'Fıstık Kreması 450g', aisle: 'D-01', quantity: 10),
      ],
    ),
    OrderModel(
      id: 'SIP-10047',
      branch: 'Muratpaşa',
      createdAt: DateTime.now().subtract(const Duration(hours: 3)),
      items: [
        OrderItem(id: 'i1', code: 'HUR-750', name: 'Kudüs Hurma 750g', aisle: 'E-02', quantity: 6),
        OrderItem(id: 'i2', code: 'KJR-300', name: 'Kavrulmuş Kaju 300g', aisle: 'A-03', quantity: 9),
        OrderItem(id: 'i3', code: 'BNM-200', name: 'Badem Unu 200g', aisle: 'F-05', quantity: 7),
      ],
    ),
  ];
}

// ========================= UYGULAMA KÖK =========================

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Depo Otomasyonu',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
      ),
      home: _AppScope(child: const SignInScreen()),
    );
  }
}

// Basit bir InheritedWidget ile AppState erişimi
class _AppScope extends StatefulWidget {
  final Widget child;
  const _AppScope({required this.child});

  static _AppScopeState of(BuildContext context) {
    final _InheritedAppState? inh = context.dependOnInheritedWidgetOfExactType<_InheritedAppState>();
    assert(inh != null, 'AppState bulunamadı');
    return inh!.state;
  }

  @override
  State<_AppScope> createState() => _AppScopeState();
}

class _AppScopeState extends State<_AppScope> {
  final AppState state = AppState();

  @override
  Widget build(BuildContext context) {
    return _InheritedAppState(state: this, child: widget.child);
  }
}

class _InheritedAppState extends InheritedWidget {
  final _AppScopeState state;
  const _InheritedAppState({required this.state, required super.child});

  @override
  bool updateShouldNotify(covariant InheritedWidget oldWidget) => true;
}

AppState appState(BuildContext context) => _AppScope.of(context).state;

// ========================= EKRANLAR =========================

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController nameCtrl = TextEditingController(text: 'Murat');
  UserRole role = UserRole.manager;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Giriş (Demo)')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Card(
            margin: const EdgeInsets.all(16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Depo Otomasyonu', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(labelText: 'Ad'),
                      validator: (v) => (v == null || v.trim().isEmpty) ? 'Zorunlu' : null,
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<UserRole>(
                      value: role,
                      decoration: const InputDecoration(labelText: 'Rol'),
                      items: const [
                        DropdownMenuItem(value: UserRole.manager, child: Text('Yönetici')),
                        DropdownMenuItem(value: UserRole.picker, child: Text('Toplayıcı')),
                        DropdownMenuItem(value: UserRole.qc, child: Text('Kontrol (QC)')),
                      ],
                      onChanged: (v) => setState(() => role = v ?? UserRole.manager),
                    ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () async {
                        if (!_formKey.currentState!.validate()) return;
                        await appState(context).signInDemo(nameCtrl.text.trim(), role);
                        if (!mounted) return;
                        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const HomeRouter()));
                      },
                      child: const Text('Giriş Yap'),
                    )
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class HomeRouter extends StatelessWidget {
  const HomeRouter({super.key});

  @override
  Widget build(BuildContext context) {
    final user = appState(context).currentUser!;
    switch (user.role) {
      case UserRole.manager:
        return const ManagerHome();
      case UserRole.picker:
        return const PickerHome();
      case UserRole.qc:
        return const QCHome();
    }
  }
}

// ------------------------- Ortak Widgetlar -------------------------

class AppScaffold extends StatelessWidget {
  final String title;
  final Widget body;
  final List<Widget>? actions;
  const AppScaffold({super.key, required this.title, required this.body, this.actions});

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final user = st.currentUser!;

    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          ...?actions,
          IconButton(
            tooltip: 'Çıkış',
            onPressed: () {
              st.signOut();
              Navigator.of(context).pushAndRemoveUntil(
                MaterialPageRoute(builder: (_) => const SignInScreen()),
                (r) => false,
              );
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          children: [
            UserAccountsDrawerHeader(
              accountName: Text(user.displayName),
              accountEmail: Text(user.role.name.toUpperCase()),
            ),
            if (user.role == UserRole.manager) ...[
              _tile(context, 'Yönetici Paneli', Icons.dashboard, const ManagerHome()),
              _tile(context, 'Ek Depo', Icons.move_up, const AdditionDepotScreen()),
              _tile(context, 'Arşiv', Icons.archive, const ArchiveScreen()),
              _tile(context, 'Ayarlar', Icons.settings, const SettingsScreen()),
            ] else if (user.role == UserRole.picker) ...[
              _tile(context, 'Toplama', Icons.list_alt, const PickerHome()),
              _tile(context, 'Ayarlar', Icons.settings, const SettingsScreen()),
            ] else ...[
              _tile(context, 'Kontrol (QC)', Icons.verified, const QCHome()),
              _tile(context, 'Ayarlar', Icons.settings, const SettingsScreen()),
            ],
          ],
        ),
      ),
      body: body,
    );
  }

  ListTile _tile(BuildContext context, String title, IconData icon, Widget target) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      onTap: () {
        Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => target));
      },
    );
  }
}

// ------------------------- Yönetici Ekranı -------------------------

class ManagerHome extends StatefulWidget {
  const ManagerHome({super.key});

  @override
  State<ManagerHome> createState() => _ManagerHomeState();
}

class _ManagerHomeState extends State<ManagerHome> {
  String q = '';

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final data = q.isEmpty ? st.ordersForRole(UserRole.manager) : st.searchOrders(q);

    return AppScaffold(
      title: 'Yönetici Paneli',
      actions: [
        IconButton(
          tooltip: 'Yenile',
          onPressed: () => setState(() {}),
          icon: const Icon(Icons.refresh),
        ),
      ],
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12.0),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Sipariş, şube, ürün ara...'),
              onChanged: (v) => setState(() => q = v),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: data.length,
              itemBuilder: (_, i) => OrderCard(order: data[i], onAssign: (o) {
                final user = st.currentUser!;
                st.assignOrder(o.id, user.id); // demo: kendine atama
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${o.id} atandı')));
                setState(() {});
              },
              onArchive: (o){ st.archiveOrder(o.id); setState((){}); },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class OrderCard extends StatelessWidget {
  final OrderModel order;
  final void Function(OrderModel order)? onAssign;
  final void Function(OrderModel order)? onArchive;
  const OrderCard({super.key, required this.order, this.onAssign, this.onArchive});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        title: Text('${order.id} • ${order.branch}'),
        subtitle: Text('Kalem: ${order.totalLines}  |  Miktar: ${order.totalQty}  | Toplanan: ${order.totalPicked}\nDurum: ${order.status.name}'),
        trailing: Wrap(spacing: 8, children: [
          if (onAssign != null) OutlinedButton(onPressed: () => onAssign!(order), child: const Text('Ata')),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: order.id)));
            },
            child: const Text('Detay'),
          ),
          if (onArchive != null) IconButton(onPressed: () => onArchive!(order), icon: const Icon(Icons.archive))
        ]),
      ),
    );
  }
}

class OrderDetailScreen extends StatefulWidget {
  final String orderId;
  const OrderDetailScreen({super.key, required this.orderId});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final order = st.allOrders.firstWhere((o) => o.id == widget.orderId);

    return AppScaffold(
      title: 'Sipariş Detayı • ${order.id}',
      actions: [
        if (order.status == OrderStatus.assigned || order.status == OrderStatus.picking)
          IconButton(onPressed: () { st.sendToQC(order.id); setState((){}); }, icon: const Icon(Icons.send))
      ],
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12.0),
            child: Row(
              children: [
                Expanded(child: Text('Şube: ${order.branch}')),
                const SizedBox(width: 12),
                Chip(label: Text(order.status.name)),
              ],
            ),
          ),
          Expanded(
            child: ListView.separated(
              itemCount: order.items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final it = order.items[i];
                return ListTile(
                  title: Text('${it.name} • ${it.code}'),
                  subtitle: Text('Raf: ${it.aisle} | İstenen: ${it.quantity} | Toplanan: ${it.picked}'),
                  trailing: SizedBox(
                    width: 180,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        IconButton(
                          tooltip: 'Eksik',
                          onPressed: () {
                            _openMissingDialog(context, order.id, it);
                          },
                          icon: const Icon(Icons.remove_circle_outline),
                        ),
                        IconButton(
                          tooltip: 'Düzenle',
                          onPressed: () async {
                            final v = await _editPickedDialog(context, it.picked, it.quantity);
                            if (v != null) {
                              st.updatePicked(order.id, it.id, v);
                              setState(() {});
                            }
                          },
                          icon: const Icon(Icons.edit),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Future<int?> _editPickedDialog(BuildContext context, int picked, int maxQty) async {
    final ctrl = TextEditingController(text: picked.toString());
    return showDialog<int>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Toplanan Miktar'),
        content: TextField(
          controller: ctrl,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(helperText: '0 - $maxQty'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('İptal')),
          FilledButton(onPressed: () { final v = int.tryParse(ctrl.text); Navigator.pop(context, v); }, child: const Text('Kaydet')),
        ],
      ),
    );
  }

  Future<void> _openMissingDialog(BuildContext context, String orderId, OrderItem item) async {
    final qtyCtrl = TextEditingController(text: '1');
    final noteCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Eksik Miktar'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${item.name} • ${item.code}\nRaf: ${item.aisle}'),
            const SizedBox(height: 12),
            TextField(
              controller: qtyCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Eksik Miktar'),
            ),
            TextField(
              controller: noteCtrl,
              decoration: const InputDecoration(labelText: 'Not (opsiyonel)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('İptal')),
          FilledButton(onPressed: () {
            final missing = int.tryParse(qtyCtrl.text) ?? 0;
            appState(context).markMissing(orderId, item.id, missing, note: noteCtrl.text.trim().isEmpty ? null : noteCtrl.text.trim());
            Navigator.pop(context);
          }, child: const Text('Kaydet')),
        ],
      ),
    );
  }
}

// ------------------------- Toplayıcı -------------------------

class PickerHome extends StatelessWidget {
  const PickerHome({super.key});

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final orders = st.ordersForRole(UserRole.picker);

    return AppScaffold(
      title: 'Toplama',
      body: ListView.builder(
        itemCount: orders.length,
        itemBuilder: (_, i) {
          final o = orders[i];
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: ListTile(
              title: Text('${o.id} • ${o.branch}'),
              subtitle: Text('Durum: ${o.status.name} | Kalem: ${o.totalLines}'),
              trailing: Wrap(spacing: 8, children: [
                OutlinedButton(
                  onPressed: () { st.startPicking(o.id); },
                  child: const Text('Başla'),
                ),
                FilledButton(
                  onPressed: () {
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: o.id)));
                  },
                  child: const Text('Topla'),
                ),
              ]),
            ),
          );
        },
      ),
    );
  }
}

// ------------------------- QC -------------------------

class QCHome extends StatelessWidget {
  const QCHome({super.key});

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final orders = st.ordersForRole(UserRole.qc);

    return AppScaffold(
      title: 'Kontrol (QC)',
      body: ListView.builder(
        itemCount: orders.length,
        itemBuilder: (_, i) {
          final o = orders[i];
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: ListTile(
              title: Text('${o.id} • ${o.branch}'),
              subtitle: Text('Toplanan: ${o.totalPicked}/${o.totalQty}'),
              trailing: Wrap(spacing: 8, children: [
                OutlinedButton(
                  onPressed: () { st.qcApprove(o.id, qcUserId: st.currentUser?.id); },
                  child: const Text('Onayla'),
                ),
                TextButton(
                  onPressed: () { Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: o.id))); },
                  child: const Text('Detay'),
                ),
              ]),
            ),
          );
        },
      ),
    );
  }
}

// ------------------------- Ek Depo -------------------------

class AdditionDepotScreen extends StatelessWidget {
  const AdditionDepotScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final items = st.additionDepot;

    return AppScaffold(
      title: 'Ek Depo (Eksikler)',
      body: ListView.separated(
        itemCount: items.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final it = items[i];
          return ListTile(
            title: Text('${it.name} • ${it.code}'),
            subtitle: Text('Miktar: ${it.quantity} | Raf: ${it.aisle}\n${it.note ?? ''}'),
            trailing: OutlinedButton(
              onPressed: () { st.moveFromAdditionDepotToControl(it.id); },
              child: const Text('Kontrole Al'),
            ),
          );
        },
      ),
    );
  }
}

// ------------------------- Arşiv -------------------------

class ArchiveScreen extends StatelessWidget {
  const ArchiveScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final data = st.archived;

    return AppScaffold(
      title: 'Arşivlenmiş Siparişler',
      body: data.isEmpty
          ? const Center(child: Text('Henüz arşiv yok'))
          : ListView.builder(
              itemCount: data.length,
              itemBuilder: (_, i) {
                final o = data[i];
                return Card(
                  margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  child: ListTile(
                    title: Text('${o.id} • ${o.branch}'),
                    subtitle: Text('Kalem: ${o.totalLines} | Durum: ${o.status.name}'),
                  ),
                );
              },
            ),
    );
  }
}

// ------------------------- Ayarlar -------------------------

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final st = appState(context);
    final user = st.currentUser!;

    return AppScaffold(
      title: 'Ayarlar',
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Kullanıcı: ${user.displayName}', style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Rol: ${user.role.name}') ,
            const SizedBox(height: 20),
            const Text('Sistem'),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              OutlinedButton.icon(onPressed: () { /* TODO: dışa aktarma */ }, icon: const Icon(Icons.download), label: const Text('Dışa Aktar')),
              OutlinedButton.icon(onPressed: () { /* TODO: içe aktarma */ }, icon: const Icon(Icons.upload), label: const Text('İçe Aktar')),
              OutlinedButton.icon(onPressed: () { /* TODO: bildirim testi */ }, icon: const Icon(Icons.notifications), label: const Text('Bildirim Testi')),
            ])
          ],
        ),
      ),
    );
  }
}
