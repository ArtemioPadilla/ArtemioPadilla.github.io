/* ──────────────────────────────────────
   Preset databases and example queries
   for the SQL Playground lab tool.
   ────────────────────────────────────── */

export interface PresetDatabase {
  id: string;
  name: string;
  description: string;
  ddl: string;
  queries: PresetQuery[];
}

export interface PresetQuery {
  label: string;
  description: string;
  sql: string;
}

/* ── Employees Database ────────────── */

const EMPLOYEES_DDL = `
CREATE TABLE department (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL
);

CREATE TABLE employee (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  department_id INTEGER REFERENCES department(id),
  hire_date TEXT NOT NULL,
  job_title TEXT NOT NULL
);

CREATE TABLE salary (
  id INTEGER PRIMARY KEY,
  employee_id INTEGER REFERENCES employee(id),
  amount REAL NOT NULL,
  effective_date TEXT NOT NULL
);

INSERT INTO department VALUES (1, 'Engineering', 'San Francisco');
INSERT INTO department VALUES (2, 'Marketing', 'New York');
INSERT INTO department VALUES (3, 'Finance', 'Chicago');
INSERT INTO department VALUES (4, 'Human Resources', 'San Francisco');
INSERT INTO department VALUES (5, 'Sales', 'New York');

INSERT INTO employee VALUES (1, 'Alice', 'Chen', 'alice@example.com', 1, '2020-03-15', 'Senior Engineer');
INSERT INTO employee VALUES (2, 'Bob', 'Smith', 'bob@example.com', 1, '2021-06-01', 'Engineer');
INSERT INTO employee VALUES (3, 'Carol', 'Johnson', 'carol@example.com', 2, '2019-11-20', 'Marketing Manager');
INSERT INTO employee VALUES (4, 'Dave', 'Wilson', 'dave@example.com', 3, '2018-01-10', 'Financial Analyst');
INSERT INTO employee VALUES (5, 'Eve', 'Brown', 'eve@example.com', 1, '2022-09-05', 'Junior Engineer');
INSERT INTO employee VALUES (6, 'Frank', 'Taylor', 'frank@example.com', 4, '2020-07-22', 'HR Specialist');
INSERT INTO employee VALUES (7, 'Grace', 'Lee', 'grace@example.com', 5, '2021-02-14', 'Sales Representative');
INSERT INTO employee VALUES (8, 'Henry', 'Martinez', 'henry@example.com', 2, '2023-01-08', 'Content Writer');
INSERT INTO employee VALUES (9, 'Ivy', 'Anderson', 'ivy@example.com', 3, '2019-05-30', 'Senior Analyst');
INSERT INTO employee VALUES (10, 'Jack', 'Thomas', 'jack@example.com', 5, '2020-11-12', 'Sales Manager');
INSERT INTO employee VALUES (11, 'Karen', 'White', 'karen@example.com', 1, '2017-08-03', 'Staff Engineer');
INSERT INTO employee VALUES (12, 'Leo', 'Harris', 'leo@example.com', 2, '2022-04-18', 'SEO Specialist');
INSERT INTO employee VALUES (13, 'Mia', 'Clark', 'mia@example.com', 4, '2021-10-25', 'HR Manager');
INSERT INTO employee VALUES (14, 'Noah', 'Lewis', 'noah@example.com', 1, '2023-03-01', 'Intern');
INSERT INTO employee VALUES (15, 'Olivia', 'Walker', 'olivia@example.com', 5, '2019-09-14', 'Sales Representative');

INSERT INTO salary VALUES (1, 1, 145000, '2020-03-15');
INSERT INTO salary VALUES (2, 1, 160000, '2022-03-15');
INSERT INTO salary VALUES (3, 2, 110000, '2021-06-01');
INSERT INTO salary VALUES (4, 3, 125000, '2019-11-20');
INSERT INTO salary VALUES (5, 3, 140000, '2022-01-01');
INSERT INTO salary VALUES (6, 4, 95000, '2018-01-10');
INSERT INTO salary VALUES (7, 4, 105000, '2020-01-01');
INSERT INTO salary VALUES (8, 5, 85000, '2022-09-05');
INSERT INTO salary VALUES (9, 6, 80000, '2020-07-22');
INSERT INTO salary VALUES (10, 7, 65000, '2021-02-14');
INSERT INTO salary VALUES (11, 7, 72000, '2023-01-01');
INSERT INTO salary VALUES (12, 8, 70000, '2023-01-08');
INSERT INTO salary VALUES (13, 9, 115000, '2019-05-30');
INSERT INTO salary VALUES (14, 9, 130000, '2022-01-01');
INSERT INTO salary VALUES (15, 10, 90000, '2020-11-12');
INSERT INTO salary VALUES (16, 10, 105000, '2022-06-01');
INSERT INTO salary VALUES (17, 11, 175000, '2017-08-03');
INSERT INTO salary VALUES (18, 11, 190000, '2021-01-01');
INSERT INTO salary VALUES (19, 12, 75000, '2022-04-18');
INSERT INTO salary VALUES (20, 13, 100000, '2021-10-25');
INSERT INTO salary VALUES (21, 14, 50000, '2023-03-01');
INSERT INTO salary VALUES (22, 15, 68000, '2019-09-14');
INSERT INTO salary VALUES (23, 15, 75000, '2022-01-01');
`.trim();

const EMPLOYEES_QUERIES: PresetQuery[] = [
  {
    label: "All employees",
    description: "Basic SELECT with all columns",
    sql: "SELECT * FROM employee;",
  },
  {
    label: "JOIN: Employees with departments",
    description: "INNER JOIN between employee and department",
    sql: `SELECT e.first_name, e.last_name, e.job_title, d.name AS department, d.location
FROM employee e
INNER JOIN department d ON e.department_id = d.id
ORDER BY d.name, e.last_name;`,
  },
  {
    label: "GROUP BY: Headcount per department",
    description: "Aggregate count grouped by department",
    sql: `SELECT d.name AS department, COUNT(*) AS headcount
FROM employee e
JOIN department d ON e.department_id = d.id
GROUP BY d.name
ORDER BY headcount DESC;`,
  },
  {
    label: "Subquery: Above-average salary",
    description: "Find employees with latest salary above average",
    sql: `SELECT e.first_name, e.last_name, s.amount AS salary
FROM employee e
JOIN salary s ON e.id = s.employee_id
WHERE s.effective_date = (
  SELECT MAX(s2.effective_date)
  FROM salary s2 WHERE s2.employee_id = e.id
)
AND s.amount > (
  SELECT AVG(s3.amount)
  FROM salary s3
  WHERE s3.effective_date = (
    SELECT MAX(s4.effective_date)
    FROM salary s4 WHERE s4.employee_id = s3.employee_id
  )
)
ORDER BY s.amount DESC;`,
  },
  {
    label: "Window: Salary rank within department",
    description: "RANK() window function partitioned by department",
    sql: `SELECT e.first_name, e.last_name, d.name AS department, s.amount AS salary,
  RANK() OVER (PARTITION BY d.name ORDER BY s.amount DESC) AS salary_rank
FROM employee e
JOIN department d ON e.department_id = d.id
JOIN salary s ON e.id = s.employee_id
WHERE s.effective_date = (
  SELECT MAX(s2.effective_date)
  FROM salary s2 WHERE s2.employee_id = e.id
);`,
  },
  {
    label: "CTE: Salary history with changes",
    description: "Common Table Expression showing salary progression",
    sql: `WITH salary_history AS (
  SELECT e.first_name || ' ' || e.last_name AS name,
         s.amount,
         s.effective_date,
         LAG(s.amount) OVER (PARTITION BY e.id ORDER BY s.effective_date) AS prev_amount
  FROM employee e
  JOIN salary s ON e.id = s.employee_id
)
SELECT name, amount, effective_date,
  CASE
    WHEN prev_amount IS NULL THEN 'Initial'
    ELSE printf('+$%,.0f (%+.1f%%)', amount - prev_amount, (amount - prev_amount) * 100.0 / prev_amount)
  END AS change
FROM salary_history
ORDER BY name, effective_date;`,
  },
];

/* ── E-commerce Database ───────────── */

const ECOMMERCE_DDL = `
CREATE TABLE customer (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  city TEXT NOT NULL,
  joined_date TEXT NOT NULL
);

CREATE TABLE product (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "order" (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customer(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE order_item (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES "order"(id),
  product_id INTEGER REFERENCES product(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);

INSERT INTO customer VALUES (1, 'Emma Davis', 'emma@shop.com', 'Portland', '2023-01-15');
INSERT INTO customer VALUES (2, 'Liam Garcia', 'liam@shop.com', 'Austin', '2023-02-20');
INSERT INTO customer VALUES (3, 'Sophia Kim', 'sophia@shop.com', 'Seattle', '2023-03-10');
INSERT INTO customer VALUES (4, 'James Brown', 'james@shop.com', 'Denver', '2023-04-05');
INSERT INTO customer VALUES (5, 'Ava Wilson', 'ava@shop.com', 'Portland', '2023-05-22');
INSERT INTO customer VALUES (6, 'Mason Lee', 'mason@shop.com', 'Austin', '2023-06-18');
INSERT INTO customer VALUES (7, 'Isabella Chen', 'isabella@shop.com', 'Seattle', '2023-07-01');
INSERT INTO customer VALUES (8, 'Ethan Patel', 'ethan@shop.com', 'Chicago', '2023-08-14');

INSERT INTO product VALUES (1, 'Wireless Keyboard', 'Electronics', 79.99, 150);
INSERT INTO product VALUES (2, 'USB-C Hub', 'Electronics', 49.99, 200);
INSERT INTO product VALUES (3, 'Standing Desk Mat', 'Office', 39.99, 80);
INSERT INTO product VALUES (4, 'Noise Cancelling Headphones', 'Electronics', 199.99, 45);
INSERT INTO product VALUES (5, 'Ergonomic Mouse', 'Electronics', 59.99, 120);
INSERT INTO product VALUES (6, 'Desk Lamp', 'Office', 34.99, 90);
INSERT INTO product VALUES (7, 'Webcam HD', 'Electronics', 89.99, 60);
INSERT INTO product VALUES (8, 'Monitor Stand', 'Office', 44.99, 75);
INSERT INTO product VALUES (9, 'Mechanical Keyboard', 'Electronics', 129.99, 55);
INSERT INTO product VALUES (10, 'Cable Management Kit', 'Office', 19.99, 200);

INSERT INTO "order" VALUES (1, 1, '2024-01-10', 'delivered');
INSERT INTO "order" VALUES (2, 2, '2024-01-15', 'delivered');
INSERT INTO "order" VALUES (3, 1, '2024-02-01', 'delivered');
INSERT INTO "order" VALUES (4, 3, '2024-02-14', 'delivered');
INSERT INTO "order" VALUES (5, 4, '2024-03-01', 'shipped');
INSERT INTO "order" VALUES (6, 5, '2024-03-10', 'delivered');
INSERT INTO "order" VALUES (7, 2, '2024-03-20', 'delivered');
INSERT INTO "order" VALUES (8, 6, '2024-04-05', 'shipped');
INSERT INTO "order" VALUES (9, 7, '2024-04-15', 'pending');
INSERT INTO "order" VALUES (10, 3, '2024-04-20', 'delivered');
INSERT INTO "order" VALUES (11, 8, '2024-05-01', 'delivered');
INSERT INTO "order" VALUES (12, 1, '2024-05-10', 'shipped');

INSERT INTO order_item VALUES (1, 1, 1, 1, 79.99);
INSERT INTO order_item VALUES (2, 1, 2, 2, 49.99);
INSERT INTO order_item VALUES (3, 2, 4, 1, 199.99);
INSERT INTO order_item VALUES (4, 2, 5, 1, 59.99);
INSERT INTO order_item VALUES (5, 3, 9, 1, 129.99);
INSERT INTO order_item VALUES (6, 4, 4, 1, 199.99);
INSERT INTO order_item VALUES (7, 4, 7, 1, 89.99);
INSERT INTO order_item VALUES (8, 5, 3, 2, 39.99);
INSERT INTO order_item VALUES (9, 5, 6, 1, 34.99);
INSERT INTO order_item VALUES (10, 6, 1, 1, 79.99);
INSERT INTO order_item VALUES (11, 6, 10, 3, 19.99);
INSERT INTO order_item VALUES (12, 7, 2, 1, 49.99);
INSERT INTO order_item VALUES (13, 7, 8, 1, 44.99);
INSERT INTO order_item VALUES (14, 8, 9, 2, 129.99);
INSERT INTO order_item VALUES (15, 9, 5, 1, 59.99);
INSERT INTO order_item VALUES (16, 9, 6, 2, 34.99);
INSERT INTO order_item VALUES (17, 10, 7, 1, 89.99);
INSERT INTO order_item VALUES (18, 10, 10, 5, 19.99);
INSERT INTO order_item VALUES (19, 11, 4, 1, 199.99);
INSERT INTO order_item VALUES (20, 11, 3, 1, 39.99);
INSERT INTO order_item VALUES (21, 12, 2, 3, 49.99);
INSERT INTO order_item VALUES (22, 12, 5, 1, 59.99);
`.trim();

const ECOMMERCE_QUERIES: PresetQuery[] = [
  {
    label: "All products",
    description: "Browse the product catalog",
    sql: "SELECT * FROM product ORDER BY category, name;",
  },
  {
    label: "JOIN: Order details",
    description: "Multi-table join showing full order info",
    sql: `SELECT o.id AS order_id, c.name AS customer, o.order_date, o.status,
  p.name AS product, oi.quantity, oi.unit_price,
  oi.quantity * oi.unit_price AS line_total
FROM "order" o
JOIN customer c ON o.customer_id = c.id
JOIN order_item oi ON o.id = oi.order_id
JOIN product p ON oi.product_id = p.id
ORDER BY o.order_date DESC, o.id;`,
  },
  {
    label: "GROUP BY: Revenue by category",
    description: "Aggregate revenue grouped by product category",
    sql: `SELECT p.category,
  COUNT(DISTINCT oi.order_id) AS total_orders,
  SUM(oi.quantity) AS units_sold,
  printf('$%,.2f', SUM(oi.quantity * oi.unit_price)) AS revenue
FROM order_item oi
JOIN product p ON oi.product_id = p.id
GROUP BY p.category
ORDER BY SUM(oi.quantity * oi.unit_price) DESC;`,
  },
  {
    label: "Subquery: Customers with 2+ orders",
    description: "Filter using a HAVING clause",
    sql: `SELECT c.name, c.city, COUNT(*) AS order_count,
  printf('$%,.2f', SUM(sub.total)) AS total_spent
FROM customer c
JOIN "order" o ON c.id = o.customer_id
JOIN (
  SELECT order_id, SUM(quantity * unit_price) AS total
  FROM order_item
  GROUP BY order_id
) sub ON o.id = sub.order_id
GROUP BY c.id
HAVING COUNT(*) >= 2
ORDER BY total_spent DESC;`,
  },
  {
    label: "Window: Running revenue total",
    description: "Cumulative sum using a window function",
    sql: `SELECT o.order_date,
  printf('$%,.2f', SUM(oi.quantity * oi.unit_price)) AS order_total,
  printf('$%,.2f', SUM(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY o.order_date)) AS running_total
FROM "order" o
JOIN order_item oi ON o.id = oi.order_id
GROUP BY o.id
ORDER BY o.order_date;`,
  },
  {
    label: "CTE: Best selling products",
    description: "Ranked product sales with CTE",
    sql: `WITH product_sales AS (
  SELECT p.id, p.name, p.category, p.price,
    SUM(oi.quantity) AS total_sold,
    SUM(oi.quantity * oi.unit_price) AS total_revenue
  FROM product p
  LEFT JOIN order_item oi ON p.id = oi.product_id
  GROUP BY p.id
)
SELECT name, category,
  printf('$%.2f', price) AS price,
  COALESCE(total_sold, 0) AS units_sold,
  printf('$%,.2f', COALESCE(total_revenue, 0)) AS revenue,
  RANK() OVER (ORDER BY total_revenue DESC) AS rank
FROM product_sales
ORDER BY rank;`,
  },
];

/* ── Movies Database ───────────────── */

const MOVIES_DDL = `
CREATE TABLE genre (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE movie (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  release_year INTEGER NOT NULL,
  genre_id INTEGER REFERENCES genre(id),
  rating REAL,
  runtime_min INTEGER
);

CREATE TABLE actor (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  birth_year INTEGER
);

CREATE TABLE role (
  id INTEGER PRIMARY KEY,
  movie_id INTEGER REFERENCES movie(id),
  actor_id INTEGER REFERENCES actor(id),
  character_name TEXT NOT NULL
);

INSERT INTO genre VALUES (1, 'Sci-Fi');
INSERT INTO genre VALUES (2, 'Drama');
INSERT INTO genre VALUES (3, 'Action');
INSERT INTO genre VALUES (4, 'Comedy');
INSERT INTO genre VALUES (5, 'Thriller');

INSERT INTO movie VALUES (1, 'Blade Runner 2049', 2017, 1, 8.0, 164);
INSERT INTO movie VALUES (2, 'The Shawshank Redemption', 1994, 2, 9.3, 142);
INSERT INTO movie VALUES (3, 'Inception', 2010, 1, 8.8, 148);
INSERT INTO movie VALUES (4, 'Pulp Fiction', 1994, 2, 8.9, 154);
INSERT INTO movie VALUES (5, 'The Dark Knight', 2008, 3, 9.0, 152);
INSERT INTO movie VALUES (6, 'Interstellar', 2014, 1, 8.7, 169);
INSERT INTO movie VALUES (7, 'The Grand Budapest Hotel', 2014, 4, 8.1, 99);
INSERT INTO movie VALUES (8, 'Parasite', 2019, 5, 8.5, 132);
INSERT INTO movie VALUES (9, 'Mad Max: Fury Road', 2015, 3, 8.1, 120);
INSERT INTO movie VALUES (10, 'Arrival', 2016, 1, 7.9, 116);
INSERT INTO movie VALUES (11, 'Whiplash', 2014, 2, 8.5, 107);
INSERT INTO movie VALUES (12, 'Dune', 2021, 1, 8.0, 155);

INSERT INTO actor VALUES (1, 'Ryan Gosling', 1980);
INSERT INTO actor VALUES (2, 'Tim Robbins', 1958);
INSERT INTO actor VALUES (3, 'Leonardo DiCaprio', 1974);
INSERT INTO actor VALUES (4, 'John Travolta', 1954);
INSERT INTO actor VALUES (5, 'Christian Bale', 1974);
INSERT INTO actor VALUES (6, 'Matthew McConaughey', 1969);
INSERT INTO actor VALUES (7, 'Ralph Fiennes', 1962);
INSERT INTO actor VALUES (8, 'Song Kang-ho', 1967);
INSERT INTO actor VALUES (9, 'Charlize Theron', 1975);
INSERT INTO actor VALUES (10, 'Amy Adams', 1974);
INSERT INTO actor VALUES (11, 'Miles Teller', 1987);
INSERT INTO actor VALUES (12, 'Timothee Chalamet', 1995);
INSERT INTO actor VALUES (13, 'Morgan Freeman', 1937);
INSERT INTO actor VALUES (14, 'Heath Ledger', 1979);
INSERT INTO actor VALUES (15, 'Tom Hardy', 1977);

INSERT INTO role VALUES (1, 1, 1, 'Officer K');
INSERT INTO role VALUES (2, 2, 2, 'Andy Dufresne');
INSERT INTO role VALUES (3, 2, 13, 'Ellis Redding');
INSERT INTO role VALUES (4, 3, 3, 'Dom Cobb');
INSERT INTO role VALUES (5, 4, 4, 'Vincent Vega');
INSERT INTO role VALUES (6, 5, 5, 'Bruce Wayne');
INSERT INTO role VALUES (7, 5, 14, 'Joker');
INSERT INTO role VALUES (8, 6, 6, 'Cooper');
INSERT INTO role VALUES (9, 7, 7, 'M. Gustave');
INSERT INTO role VALUES (10, 8, 8, 'Ki-taek');
INSERT INTO role VALUES (11, 9, 9, 'Furiosa');
INSERT INTO role VALUES (12, 9, 15, 'Max');
INSERT INTO role VALUES (13, 10, 10, 'Louise Banks');
INSERT INTO role VALUES (14, 11, 11, 'Andrew Neiman');
INSERT INTO role VALUES (15, 12, 12, 'Paul Atreides');
INSERT INTO role VALUES (16, 3, 15, 'Eames');
INSERT INTO role VALUES (17, 6, 10, 'Brand');
`.trim();

const MOVIES_QUERIES: PresetQuery[] = [
  {
    label: "All movies",
    description: "Browse the movie catalog",
    sql: `SELECT m.title, m.release_year, g.name AS genre, m.rating, m.runtime_min
FROM movie m
JOIN genre g ON m.genre_id = g.id
ORDER BY m.rating DESC;`,
  },
  {
    label: "JOIN: Full cast listing",
    description: "Movies with their actors and character names",
    sql: `SELECT m.title, m.release_year, a.name AS actor, r.character_name
FROM role r
JOIN movie m ON r.movie_id = m.id
JOIN actor a ON r.actor_id = a.id
ORDER BY m.title, a.name;`,
  },
  {
    label: "GROUP BY: Movies per genre",
    description: "Count and average rating by genre",
    sql: `SELECT g.name AS genre,
  COUNT(*) AS movie_count,
  ROUND(AVG(m.rating), 1) AS avg_rating,
  MIN(m.release_year) || '-' || MAX(m.release_year) AS year_range
FROM movie m
JOIN genre g ON m.genre_id = g.id
GROUP BY g.name
ORDER BY avg_rating DESC;`,
  },
  {
    label: "Subquery: Actors in 2+ movies",
    description: "Actors appearing in multiple films",
    sql: `SELECT a.name, a.birth_year, COUNT(*) AS movie_count
FROM actor a
JOIN role r ON a.id = r.actor_id
WHERE a.id IN (
  SELECT actor_id FROM role
  GROUP BY actor_id
  HAVING COUNT(*) >= 2
)
GROUP BY a.id
ORDER BY movie_count DESC;`,
  },
  {
    label: "Window: Rating rank by genre",
    description: "Ranked movies within each genre",
    sql: `SELECT g.name AS genre, m.title, m.rating,
  RANK() OVER (PARTITION BY g.name ORDER BY m.rating DESC) AS genre_rank,
  DENSE_RANK() OVER (ORDER BY m.rating DESC) AS overall_rank
FROM movie m
JOIN genre g ON m.genre_id = g.id
ORDER BY g.name, genre_rank;`,
  },
  {
    label: "CTE: Actor filmography summary",
    description: "Summary stats per actor using CTE",
    sql: `WITH filmography AS (
  SELECT a.id, a.name, a.birth_year,
    COUNT(*) AS roles,
    GROUP_CONCAT(m.title, ', ') AS movies,
    ROUND(AVG(m.rating), 1) AS avg_movie_rating
  FROM actor a
  JOIN role r ON a.id = r.actor_id
  JOIN movie m ON r.movie_id = m.id
  GROUP BY a.id
)
SELECT name, birth_year, roles, movies, avg_movie_rating
FROM filmography
ORDER BY avg_movie_rating DESC;`,
  },
];

/* ── Empty Database ────────────────── */

const EMPTY_QUERIES: PresetQuery[] = [
  {
    label: "Create a table",
    description: "DDL example to get started",
    sql: `CREATE TABLE todo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  done INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);`,
  },
  {
    label: "Insert data",
    description: "Add some sample rows",
    sql: `INSERT INTO todo (task) VALUES ('Learn SQL');
INSERT INTO todo (task) VALUES ('Build something cool');
INSERT INTO todo (task) VALUES ('Ship it');

SELECT * FROM todo;`,
  },
  {
    label: "SQLite version",
    description: "Check the SQLite version",
    sql: "SELECT sqlite_version() AS version;",
  },
];

/* ── Exported presets ──────────────── */

export const PRESET_DATABASES: PresetDatabase[] = [
  {
    id: "employees",
    name: "Employees",
    description: "Departments, employees, and salaries (~50 rows)",
    ddl: EMPLOYEES_DDL,
    queries: EMPLOYEES_QUERIES,
  },
  {
    id: "ecommerce",
    name: "E-commerce",
    description: "Products, orders, customers (~30 rows each)",
    ddl: ECOMMERCE_DDL,
    queries: ECOMMERCE_QUERIES,
  },
  {
    id: "movies",
    name: "Movies",
    description: "Movies, actors, roles, genres (~40 rows)",
    ddl: MOVIES_DDL,
    queries: MOVIES_QUERIES,
  },
  {
    id: "empty",
    name: "Empty",
    description: "Start fresh, create your own tables",
    ddl: "",
    queries: EMPTY_QUERIES,
  },
];
