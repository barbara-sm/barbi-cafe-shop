-- Rode uma vez: npm run db:init
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  category    TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  price       INTEGER NOT NULL CHECK (price >= 0),          -- em centavos
  emoji       TEXT    NOT NULL DEFAULT '☕',
  image_url   TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  customer_name TEXT    NOT NULL,
  phone         TEXT    NOT NULL,
  mode          TEXT    NOT NULL CHECK (mode IN ('retirada','entrega')),
  address       TEXT,
  payment       TEXT    NOT NULL CHECK (payment IN ('pix','cartao','dinheiro')),
  notes         TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'novo'
                CHECK (status IN ('novo','preparando','pronto','entregue','cancelado')),
  subtotal      INTEGER NOT NULL,
  delivery_fee  INTEGER NOT NULL,
  total         INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT    NOT NULL,      -- nome e preço ficam gravados no pedido
  unit_price INTEGER NOT NULL,
  quantity   INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);

-- Cardápio inicial (só entra se a tabela estiver vazia)
INSERT INTO products (category, name, description, price, emoji, image_url, sort)
SELECT * FROM (VALUES
  ('Cafés','Espresso','Blend especial, extração curta.',1200,'☕','img/espresso.jpg',1),
  ('Cafés','Café coado V60','Origem única, notas frutadas.',1600,'☕','img/cafe-coado.jpg',2),
  ('Cafés','Cappuccino','Espresso duplo e espuma sedosa.',1800,'☕','img/cappuccino.jpg',3),
  ('Cafés','Latte de baunilha','Calda de baunilha da casa.',2200,'🥛','img/latte-baunilha.jpg',4),
  ('Cafés','Mocha de chocolate belga','Espresso, chocolate e chantilly.',2400,'🍫','img/mocha.jpg',5),
  ('Sobremesas','Brownie com sorvete','Chocolate 70% quentinho.',3200,'🍫','img/brownie-sorvete.jpg',6),
  ('Sobremesas','Cheesecake de frutas vermelhas','Calda artesanal.',3600,'🍰','img/cheesecake.jpg',7),
  ('Sobremesas','Bolo de cenoura','Cobertura de chocolate meio amargo.',2600,'🍰','img/bolo-cenoura.jpg',8),
  ('Sobremesas','Pudim de leite','Cremoso, com calda de caramelo.',2400,'🍮','img/pudim.jpg',9),
  ('Sobremesas','Torta de limão siciliano','Merengue maçaricado.',2800,'🍋','img/torta-limao.jpg',10),
  ('Refrigerantes','Refrigerante cola','Lata de 350 ml.',1200,'🥤','img/refri-cola.jpg',11),
  ('Refrigerantes','Guaraná','Lata de 350 ml.',1200,'🥤','img/guarana.jpg',12),
  ('Sucos','Suco de laranja','Espremido na hora, 400 ml.',1800,'🍊','img/suco-laranja.jpg',13),
  ('Sucos','Suco de maracujá','Polpa natural, 400 ml.',1800,'🍹','img/suco-maracuja.jpg',14),
  ('Sucos','Abacaxi com hortelã','Hortelã fresca, 400 ml.',2000,'🍍','img/suco-abacaxi.jpg',15),
  ('Águas','Água mineral sem gás','Garrafa de vidro, 500 ml.',800,'💧','img/agua.jpg',16),
  ('Águas','Água mineral com gás','Garrafa de vidro, 500 ml.',900,'🫧','img/agua-gas.jpg',17)
) AS v(category, name, description, price, emoji, image_url, sort)
WHERE NOT EXISTS (SELECT 1 FROM products);
