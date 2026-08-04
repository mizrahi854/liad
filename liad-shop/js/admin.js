/* ==========================================================================
   LIAD — חנות | דף ניהול
   ניהול מלאי וצפייה בהזמנות. עובד מקומית (localStorage) עד שיהיה שרת.
   ========================================================================== */

import { $, $$, html, esc, money, CONFIG, loadCatalog, toast } from "./store.js";
import { initAccessibility } from "./accessibility.js";

const STOCK_OVERRIDES = "liad:stock-overrides";

const state = { products: [], overrides: {}, search: "", filter: "all" };

/* ---------------------------------------------------------------- אתחול */

async function init() {
  initAccessibility();
  $("#copyrightYear").textContent = new Date().getFullYear();

  state.overrides = readJSON(STOCK_OVERRIDES, {});
  const catalog = await loadCatalog();

  if (!catalog) {
    $("#stockBody").innerHTML =
      `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--muted-foreground)">
         הקטלוג לא נטען. יש להריץ דרך שרת מקומי.
       </td></tr>`;
    return;
  }

  // המלאי בפועל = מה שבקטלוג, אלא אם עודכן כאן
  state.products = catalog.map((p) => ({
    ...p,
    stock: state.overrides[p.id] ?? p.stock,
  }));

  wireTabs();
  wireStockControls();
  wireOrderControls();
  renderStats();
  renderStock();
  renderOrders();
}

/* ---------------------------------------------------------------- עזרים */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function getOrders() {
  return readJSON(CONFIG.storageKeys.orders, []);
}

function download(filename, content, type = "application/json") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- לשוניות */

function wireTabs() {
  $$(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".admin-tab").forEach((t) => t.setAttribute("aria-selected", "false"));
      tab.setAttribute("aria-selected", "true");
      const target = tab.dataset.tab;
      $("#tabStock").hidden = target !== "stock";
      $("#tabOrders").hidden = target !== "orders";
    });
  });
}

/* ---------------------------------------------------------------- סטטיסטיקה */

function renderStats() {
  const orders = getOrders();
  $("#statProducts").textContent = state.products.length;
  $("#statOut").textContent = state.products.filter((p) => p.stock === 0).length;
  $("#statOrders").textContent = orders.length;
  $("#statRevenue").textContent = money(
    orders.reduce((sum, o) => sum + (o.totals?.total ?? 0), 0)
  );
}

/* ---------------------------------------------------------------- מלאי */

function wireStockControls() {
  let timer;
  $("#stockSearch").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = e.target.value.trim().toLowerCase();
      renderStock();
    }, 180);
  });

  $("#stockFilter").addEventListener("change", (e) => {
    state.filter = e.target.value;
    renderStock();
  });

  // עדכון מלאי
  $("#stockBody").addEventListener("change", (e) => {
    const input = e.target.closest(".stock-input");
    if (!input) return;

    const id = input.closest("tr").dataset.id;
    const value = Math.max(0, parseInt(input.value, 10) || 0);
    const product = state.products.find((p) => p.id === id);
    if (!product) return;

    product.stock = value;
    state.overrides[id] = value;
    localStorage.setItem(STOCK_OVERRIDES, JSON.stringify(state.overrides));

    input.classList.toggle("is-zero", value === 0);
    const pill = input.closest("tr").querySelector(".pill");
    pill.className = `pill ${value === 0 ? "pill--out" : "pill--ok"}`;
    pill.textContent = value === 0 ? "אזל" : "במלאי";

    renderStats();
    toast(`המלאי של "${product.title}" עודכן ל-${value}`);
  });

  $("#exportBtn").addEventListener("click", () => {
    const clean = state.products.map(({ stock, ...rest }) => ({ ...rest, stock }));
    download("products.json", JSON.stringify({ products: clean }, null, 1));
    toast("הקובץ הורד — יש להחליף אותו בתיקיית data/");
  });

  $("#resetStockBtn").addEventListener("click", () => {
    if (!confirm("לאפס את כל שינויי המלאי ולחזור לערכים שבקובץ?")) return;
    localStorage.removeItem(STOCK_OVERRIDES);
    location.reload();
  });
}

function renderStock() {
  let list = state.products;

  if (state.search) {
    list = list.filter((p) =>
      p.title.toLowerCase().includes(state.search) ||
      p.brand.toLowerCase().includes(state.search)
    );
  }
  if (state.filter === "out") list = list.filter((p) => p.stock === 0);
  if (state.filter === "low") list = list.filter((p) => p.stock > 0 && p.stock <= 3);

  const body = $("#stockBody");
  body.innerHTML = "";

  if (!list.length) {
    body.innerHTML =
      `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--muted-foreground)">
         לא נמצאו מוצרים
       </td></tr>`;
    return;
  }

  list.slice(0, 300).forEach((p) => {
    const out = p.stock === 0;
    body.append(html`
      <tr data-id="${esc(p.id)}">
        <td><img class="thumb" src="${esc(p.image)}" alt="" loading="lazy"></td>
        <td>${esc(p.title)}</td>
        <td style="color:var(--muted-foreground)">${esc(p.brand)}</td>
        <td style="font-variant-numeric:tabular-nums">${money(p.price)}</td>
        <td><input class="stock-input ${out ? "is-zero" : ""}" type="number" min="0" value="${p.stock}" aria-label="מלאי"></td>
        <td><span class="pill ${out ? "pill--out" : "pill--ok"}">${out ? "אזל" : "במלאי"}</span></td>
      </tr>
    `);
  });

  if (list.length > 300) {
    body.append(html`
      <tr><td colspan="6" style="padding:1rem;text-align:center;color:var(--muted-foreground)">
        מוצגים 300 מתוך ${list.length} — צמצמו בעזרת החיפוש
      </td></tr>`);
  }
}

/* ---------------------------------------------------------------- הזמנות */

function wireOrderControls() {
  $("#exportOrdersBtn").addEventListener("click", () => {
    const orders = getOrders();
    if (!orders.length) return toast("אין הזמנות לייצוא", "info");

    const head = ["מספר הזמנה", "תאריך", "שם", "טלפון", "אימייל", "אופן קבלה", "כתובת", "פריטים", "סה\"כ"];
    const rows = orders.map((o) => [
      o.id,
      new Date(o.createdAt).toLocaleString("he-IL"),
      `${o.customer.firstName} ${o.customer.lastName}`,
      o.customer.phone,
      o.customer.email,
      o.shipping.method === "delivery" ? "משלוח" : "איסוף עצמי",
      o.shipping.method === "delivery"
        ? `${o.shipping.address.street}, ${o.shipping.address.city}`
        : o.shipping.address.pickup,
      o.items.map((i) => `${i.title} x${i.qty}`).join(" | "),
      o.totals.total,
    ]);

    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    download("orders.csv", "﻿" + csv, "text/csv");
    toast("קובץ ההזמנות הורד");
  });

  $("#clearOrdersBtn").addEventListener("click", () => {
    if (!confirm("למחוק את כל ההזמנות? הפעולה בלתי הפיכה.")) return;
    localStorage.removeItem(CONFIG.storageKeys.orders);
    renderOrders();
    renderStats();
    toast("ההזמנות נמחקו");
  });
}

function renderOrders() {
  const orders = getOrders().slice().reverse();
  const box = $("#ordersList");

  if (!orders.length) {
    box.innerHTML = `
      <div style="padding:3rem;text-align:center;color:var(--muted-foreground);
                  border:1px solid var(--border);border-radius:1rem;background:var(--card)">
        <p style="font-family:var(--font-display);font-size:1.125rem;color:var(--foreground)">אין עדיין הזמנות</p>
        <p style="margin-top:.5rem;font-size:.875rem">הזמנות שיבוצעו בדפדפן הזה יופיעו כאן.</p>
      </div>`;
    return;
  }

  box.innerHTML = "";
  orders.forEach((o) => {
    const items = o.items
      .map((i) => `<li style="display:flex;justify-content:space-between;gap:1rem;padding:.25rem 0">
                     <span>${esc(i.title)} × ${i.qty}</span>
                     <span style="font-variant-numeric:tabular-nums">${money(i.lineTotal)}</span>
                   </li>`)
      .join("");

    box.append(html`
      <details style="margin-bottom:.75rem;border:1px solid var(--border);border-radius:1rem;background:var(--card);overflow:hidden">
        <summary style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.25rem;cursor:pointer">
          <span>
            <strong style="font-family:var(--font-wordmark);letter-spacing:.05em">${esc(o.id)}</strong>
            <span style="margin-inline-start:.75rem;font-size:.8125rem;color:var(--muted-foreground)">
              ${esc(o.customer.firstName)} ${esc(o.customer.lastName)} ·
              ${new Date(o.createdAt).toLocaleDateString("he-IL")}
            </span>
          </span>
          <span style="display:flex;align-items:center;gap:.75rem">
            <span class="pill pill--out">לא שולם</span>
            <strong style="font-variant-numeric:tabular-nums">${money(o.totals.total)}</strong>
          </span>
        </summary>

        <div style="padding:0 1.25rem 1.25rem;font-size:.875rem">
          <div style="display:grid;gap:.375rem;padding:1rem 0;border-top:1px solid var(--border);color:var(--muted-foreground)">
            <div>טלפון: <span style="color:var(--foreground)">${esc(o.customer.phone)}</span></div>
            <div>אימייל: <span style="color:var(--foreground)">${esc(o.customer.email)}</span></div>
            <div>${o.shipping.method === "delivery" ? "משלוח" : "איסוף"}:
              <span style="color:var(--foreground)">${esc(
                o.shipping.method === "delivery"
                  ? `${o.shipping.address.street}, ${o.shipping.address.city}`
                  : o.shipping.address.pickup
              )}</span></div>
            ${o.notes ? `<div>הערות: <span style="color:var(--foreground)">${esc(o.notes)}</span></div>` : ""}
          </div>
          <ul style="padding-top:.75rem;border-top:1px solid var(--border)">${items}</ul>
        </div>
      </details>
    `);
  });
}

document.addEventListener("DOMContentLoaded", init);
