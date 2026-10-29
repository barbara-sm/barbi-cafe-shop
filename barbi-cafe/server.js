require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE_CENTS || 1000);
const STATUSES = ['novo', 'preparando', 'pronto', 'entregue', 'cancelado'];

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

/* ---------- Público: cardápio e pedidos ---------- */
app.get('/api/menu', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, category, name, description, price, emoji, image_url FROM products WHERE active ORDER BY sort, id');
  res.json(rows.map(p => ({ id: String(p.id), category: p.category, name: p.name,
    description: p.description, price: p.price, emoji: p.emoji, image: p.image_url })));
}));

app.post('/api/orders', wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.customer?.name || '').trim();
  const phone = String(b.customer?.phone || '').trim();
  const { mode, payment } = b;
  const address = mode === 'entrega' ? String(b.address || '').trim() : null;
  const notes = String(b.notes || '').trim().slice(0, 300);

  if (name.length < 2 || name.length > 80) return bad(res, 'Informe seu nome.');
  if (phone.replace(/\D/g, '').length < 10 || phone.length > 20) return bad(res, 'Informe um telefone com DDD.');
  if (!['retirada', 'entrega'].includes(mode)) return bad(res, 'Escolha retirada ou entrega.');
  if (!['pix', 'cartao', 'dinheiro'].includes(payment)) return bad(res, 'Escolha a forma de pagamento.');
  if (mode === 'entrega' && (address.length < 5 || address.length > 200)) return bad(res, 'Informe o endereço completo.');

  const qty = new Map();
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const id = parseInt(it.id, 10), q = parseInt(it.quantity, 10);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1 || q > 50) return bad(res, 'Item inválido no carrinho.');
    qty.set(id, (qty.get(id) || 0) + q);
  }
  if (!qty.size || qty.size > 40) return bad(res, 'Seu carrinho está vazio.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Preços sempre vêm do banco, nunca do navegador.
    const { rows: prods } = await client.query(
      'SELECT id, name, price FROM products WHERE active AND id = ANY($1::int[])', [[...qty.keys()]]);
    if (prods.length !== qty.size) {
      await client.query('ROLLBACK');
      return bad(res, 'Algum item não está mais disponível. Atualize o cardápio.', 409);
    }
    const subtotal = prods.reduce((s, p) => s + p.price * qty.get(p.id), 0);
    const fee = mode === 'entrega' ? DELIVERY_FEE : 0;
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (customer_name, phone, mode, address, payment, notes, subtotal, delivery_fee, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [name, phone, mode, address, payment, notes, subtotal, fee, subtotal + fee]);
    for (const p of prods) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)',
        [order.id, p.id, p.name, p.price, qty.get(p.id)]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: order.id, total: subtotal + fee });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

/* ---------- Admin (Authorization: Bearer ADMIN_TOKEN) ---------- */
function auth(req, res, next) {
  const given = Buffer.from((req.get('authorization') || '').replace(/^Bearer /, ''));
  const real = Buffer.from(ADMIN_TOKEN);
  if (!ADMIN_TOKEN || given.length !== real.length || !crypto.timingSafeEqual(given, real)) {
    return bad(res, 'Não autorizado.', 401);
  }
  next();
}
const admin = express.Router();
admin.use(auth);
app.use('/api/admin', admin);

function readProduct(b = {}) {
  const category = String(b.category || '').trim(), name = String(b.name || '').trim();
  const price = Number(b.price);
  if (!category || !name) return ['Categoria e nome são obrigatórios.'];
  if (!Number.isInteger(price) || price < 0) return ['Preço inválido.'];
  return [null, [category.slice(0, 40), name.slice(0, 80), String(b.description || '').slice(0, 200), price,
    String(b.emoji || '☕').slice(0, 8), String(b.image_url || '').trim().slice(0, 500) || null,
    b.active !== false, parseInt(b.sort, 10) || 0]];
}

admin.get('/products', wrap(async (_req, res) => {
  res.json((await pool.query('SELECT * FROM products ORDER BY sort, id')).rows);
}));

admin.post('/products', wrap(async (req, res) => {
  const [err, v] = readProduct(req.body);
  if (err) return bad(res, err);
  const { rows } = await pool.query(
    `INSERT INTO products (category, name, description, price, emoji, image_url, active, sort)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, v);
  res.status(201).json(rows[0]);
}));

admin.put('/products/:id', wrap(async (req, res) => {
  const [err, v] = readProduct(req.body);
  if (err) return bad(res, err);
  const { rows } = await pool.query(
    `UPDATE products SET category=$1, name=$2, description=$3, price=$4, emoji=$5, image_url=$6, active=$7, sort=$8
     WHERE id=$9 RETURNING *`, [...v, parseInt(req.params.id, 10)]);
  rows[0] ? res.json(rows[0]) : bad(res, 'Produto não encontrado.', 404);
}));

admin.delete('/products/:id', wrap(async (req, res) => {
  const r = await pool.query('DELETE FROM products WHERE id=$1', [parseInt(req.params.id, 10)]);
  r.rowCount ? res.json({ ok: true }) : bad(res, 'Produto não encontrado.', 404);
}));

// Pedidos em andamento + finalizados nas últimas 48 h
admin.get('/orders', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT o.*, COALESCE(json_agg(json_build_object('name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price)
              ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM orders o LEFT JOIN order_items i ON i.order_id = o.id
      WHERE o.status IN ('novo','preparando','pronto') OR o.created_at > now() - interval '48 hours'
      GROUP BY o.id ORDER BY o.created_at DESC LIMIT 300`);
  res.json(rows);
}));

admin.patch('/orders/:id/status', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) return bad(res, 'Status inválido.');
  const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING id, status',
    [status, parseInt(req.params.id, 10)]);
  rows[0] ? res.json(rows[0]) : bad(res, 'Pedido não encontrado.', 404);
}));

app.use('/api', (_req, res) => bad(res, 'Rota não encontrada.', 404));
app.use((err, _req, res, _next) => { console.error(err); bad(res, 'Erro interno. Tente novamente.', 500); });

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Barbi Café Shop em http://localhost:${port}  (painel: /admin)`));
