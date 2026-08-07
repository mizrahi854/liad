/* ==========================================================================
   LIAD — חנות | מעקב הזמנה

   הקונה מקלידה מספר הזמנה ורואה איפה ההזמנה נמצאת. הסטטוס עצמו מוגדר
   במערכת הניהול, ומשם הוא מגיע לכאן.

   אפשר להגיע לעמוד גם עם המספר בכתובת — order.html?id=LIAD-…‎ — וזה
   הקישור שנשלח ללקוחה בסיום ההזמנה, כדי שלא תצטרך להקליד כלום.

   מגבלה שחשוב להכיר: כל עוד אין שרת, ההזמנות שמורות ב-localStorage של
   הדפדפן. כלומר הקונה תראה את ההזמנה שלה רק מאותו מכשיר שבו הזמינה.
   כשיחובר שרת, רק loadOrder() כאן משתנה לקריאת API.
   ========================================================================== */

import { $, esc, money } from "./store.js";
import { initShared } from "./shared.js";
import { initMotion } from "./motion.js";
import { findOrder, ORDER_STATUSES, ORDER_CANCELLED, orderStatusMeta } from "./admin-store.js";
import { openInvoice, downloadInvoice } from "./invoice.js";

let current = null;

async function init() {
  await initShared();

  const form = $("#trackForm");
  const input = $("#orderInput");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    lookup(input.value);
  });

  // הגעה עם מספר בכתובת — מציגים מיד, בלי להקליד
  const fromUrl = new URLSearchParams(location.search).get("id");
  if (fromUrl) {
    input.value = fromUrl;
    lookup(fromUrl);
  }

  initMotion();
}

/* ---------------------------------------------------------------- חיפוש */

async function lookup(value) {
  const status = $("#trackStatus");
  const box = $("#trackResult");
  const id = String(value || "").trim();

  if (!id) {
    status.dataset.state = "error";
    status.textContent = "צריך להזין מספר הזמנה";
    box.innerHTML = "";
    return;
  }

  status.dataset.state = "";
  status.textContent = "מחפשים…";
  const order = await findOrder(id);

  if (!order) {
    status.dataset.state = "error";
    status.textContent = "";
    box.innerHTML = `
      <div class="track__empty">
        <p class="track__empty-title">לא מצאנו הזמנה עם המספר הזה</p>
        <p>
          כדאי לוודא שהמספר הועתק במלואו. אם ההזמנה בוצעה במכשיר אחר,
          המעקב עדיין לא זמין ממכשיר זה — אפשר לפנות אלינו ונבדוק ידנית.
        </p>
        <a class="btn btn--outline" href="mailto:rubinliad@gmail.com?subject=בירור על הזמנה ${encodeURIComponent(id)}">
          פנייה אלינו
        </a>
      </div>`;
    return;
  }

  status.dataset.state = "success";
  status.textContent = "";
  current = order;
  render(order);
  history.replaceState(null, "", `order.html?id=${encodeURIComponent(order.id)}`);
}

/* ---------------------------------------------------------------- תצוגה */

function render(order) {
  const cancelled = order.status === ORDER_CANCELLED.id;
  const currentIndex = ORDER_STATUSES.findIndex((s) => s.id === (order.status ?? "received"));
  const meta = orderStatusMeta(order.status);

  const when = (statusId) => {
    const entry = (order.statusHistory ?? []).filter((h) => h.status === statusId).pop();
    return entry
      ? new Date(entry.at).toLocaleDateString("he-IL", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })
      : "";
  };

  const steps = ORDER_STATUSES.map((step, i) => {
    const state = cancelled ? "idle" : i < currentIndex ? "done" : i === currentIndex ? "current" : "idle";
    return `
      <li class="track-step track-step--${state}">
        <span class="track-step__dot" aria-hidden="true"></span>
        <span class="track-step__body">
          <span class="track-step__label">${esc(step.label)}</span>
          ${state === "current" ? `<span class="track-step__note">${esc(step.note)}</span>` : ""}
          ${when(step.id) ? `<span class="track-step__time">${esc(when(step.id))}</span>` : ""}
        </span>
      </li>`;
  }).join("");

  const address = order.shipping.method === "delivery"
    ? [order.shipping.address.street, order.shipping.address.city].filter(Boolean).join(", ")
    : `איסוף עצמי — ${order.shipping.address.pickup}`;

  $("#trackResult").innerHTML = `
    <article class="track-card" data-reveal="up">

      <header class="track-card__head">
        <div>
          <p class="track-card__eyebrow">הזמנה</p>
          <p class="track-card__id">${esc(order.id)}</p>
        </div>
        <span class="track-card__badge${cancelled ? " is-cancelled" : ""}">${esc(meta.label)}</span>
      </header>

      ${cancelled
        ? `<p class="track-card__cancelled">${esc(ORDER_CANCELLED.note)}</p>`
        : `<ol class="track-steps">${steps}</ol>`}

      <dl class="track-card__facts">
        <div><dt>תאריך הזמנה</dt><dd>${esc(new Date(order.createdAt).toLocaleDateString("he-IL"))}</dd></div>
        <div><dt>${order.shipping.method === "delivery" ? "כתובת למשלוח" : "איסוף"}</dt><dd>${esc(address)}</dd></div>
        <div><dt>פריטים</dt><dd>${order.items.reduce((n, i) => n + i.qty, 0)}</dd></div>
        <div><dt>סה״כ</dt><dd>${money(order.totals.total)}</dd></div>
      </dl>

      <ul class="track-card__items">
        ${order.items.map((i) => `
          <li>
            <span>${esc(i.title)} × ${i.qty}</span>
            <span class="num">${money(i.lineTotal)}</span>
          </li>`).join("")}
      </ul>

      <div class="track-card__actions">
        <button class="btn btn--gold btn--sm" type="button" id="viewInvoice">צפייה בחשבונית</button>
        <button class="btn btn--outline btn--sm" type="button" id="saveInvoice">הורדת PDF</button>
        <a class="btn btn--outline btn--sm" href="index.html">המשך קנייה</a>
      </div>
    </article>`;

  $("#viewInvoice").addEventListener("click", () => guard(() => openInvoice(current)));
  $("#saveInvoice").addEventListener("click", () => guard(() => downloadInvoice(current)));

  initMotion();
}

async function guard(action) {
  try {
    await action();
  } catch (err) {
    console.error("[LIAD] יצירת החשבונית נכשלה:", err);
    const status = $("#trackStatus");
    status.dataset.state = "error";
    status.textContent = "לא הצלחנו להכין את החשבונית. אפשר לנסות שוב.";
  }
}

document.addEventListener("DOMContentLoaded", init);
