/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { OdooInvoice, BotLog, OdooConfig, TelegramConfig } from './src/types';

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini Client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Config database path
const CONFIG_FILE = path.join(process.cwd(), 'config_db.json');

// Memory storage for Bot Logs & Config
let botLogs: BotLog[] = [
  {
    id: 'system_init',
    timestamp: new Date().toISOString(),
    type: 'system',
    sender: 'Sistem',
    message: 'Dashboard Odoo AR Telegram Assistant berhasil diinisialisasi.',
    details: 'Sistem siap dalam mode hybrid (Simulasi + Riil Odoo ERP).'
  }
];

function getSavedConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to read config file, using default structure', error);
  }
  return {
    odoo: { url: '', db: '', username: '', apiKey: '' },
    telegram: { botToken: '', chatId: '', isActive: false },
    simulationMode: true
  };
}

function saveConfig(config: any) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to write config file', error);
  }
}

// In-Memory Storage for dynamic runtime updates
let activeConfig = getSavedConfig();

// Help seed simulated invoices
const SIMULATED_INVOICES: OdooInvoice[] = [
  {
    id: 101,
    number: 'INV/2026/05/0012',
    customerName: 'PT Nusantara Jaya Mandiri',
    customerEmail: 'finance@nusantarajaya.co.id',
    date: '2026-05-10',
    dueDate: '2026-06-09',
    amountTotal: 45000000,
    amountResidual: 45000000,
    status: 'overdue',
    daysOverdue: 5
  },
  {
    id: 102,
    number: 'INV/2026/05/0045',
    customerName: 'CV Sumber Makmur',
    customerEmail: 'sumbermakmur.purwokerto@gmail.com',
    date: '2026-05-20',
    dueDate: '2026-06-19',
    amountTotal: 18500000,
    amountResidual: 18500000,
    status: 'not_paid',
    daysOverdue: 0
  },
  {
    id: 103,
    number: 'INV/2026/04/0081',
    customerName: 'PT Elang Perkasa Konstruksi',
    customerEmail: 'ar@epk-group.com',
    date: '2026-04-12',
    dueDate: '2026-05-12',
    amountTotal: 120000000,
    amountResidual: 85000000,
    status: 'overdue',
    daysOverdue: 33
  },
  {
    id: 104,
    number: 'INV/2026/05/0091',
    customerName: 'Toko Elektronik Cahaya Baru',
    customerEmail: 'cahayabaru.bpp@gmail.com',
    date: '2026-05-25',
    dueDate: '2026-06-24',
    amountTotal: 7200000,
    amountResidual: 7200000,
    status: 'not_paid',
    daysOverdue: 0
  },
  {
    id: 105,
    number: 'INV/2026/03/0112',
    customerName: 'PT Global Indo Kuliner',
    customerEmail: 'finance@globalindo-kuliner.id',
    date: '2026-03-01',
    dueDate: '2026-03-31',
    amountTotal: 32000000,
    amountResidual: 32000000,
    status: 'overdue',
    daysOverdue: 75
  },
  {
    id: 106,
    number: 'INV/2026/05/0122',
    customerName: 'PT Multi Teknik Solusi',
    customerEmail: 'accounts@multiteknik.co.id',
    date: '2026-05-01',
    dueDate: '2026-05-31',
    amountTotal: 58000000,
    amountResidual: 0,
    status: 'paid',
    daysOverdue: 0
  },
  {
    id: 107,
    number: 'INV/2026/06/0002',
    customerName: 'Koperasi Karyawan Sejahtera',
    customerEmail: 'koperasi@karyawan-sejahtera.org',
    date: '2026-06-05',
    dueDate: '2026-07-05',
    amountTotal: 12500000,
    amountResidual: 12500000,
    status: 'not_paid',
    daysOverdue: 0
  }
];

// Helper: Format amount into IDR Rupiah
function formatIDR(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value);
}

// Odoo JSON-RPC Fetch Utility
async function callOdooRpc(config: OdooConfig, service: 'common' | 'object', method: string, args: any[]) {
  let cleanBaseUrl = config.url.trim();
  try {
    const parsed = new URL(cleanBaseUrl);
    cleanBaseUrl = parsed.origin;
  } catch (e) {
    cleanBaseUrl = cleanBaseUrl
      .replace(/\/web\/login.*$/, '')
      .replace(/\/web.*$/, '')
      .replace(/\/$/, '');
  }
  
  const url = `${cleanBaseUrl}/jsonrpc`;
  try {
    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      console.error('Odoo RPC Error details:', data.error);
      throw new Error(data.error.data?.message || data.error.message || 'Unknown Odoo RPC Error');
    }

    return data.result;
  } catch (error: any) {
    console.error('Odoo API connection failed:', error.message);
    throw new Error(`Koneksi Odoo Gagal: ${error.message}`);
  }
}

// Translate raw Odoo invoices to our uniform format
function mapOdooInvoices(rawInvoices: any[]): OdooInvoice[] {
  const today = new Date(); today.setHours(0,0,0,0);
  return rawInvoices.map((inv: any) => {
    const amountTotal = inv.amount_total || 0;
    const amountResidual = inv.amount_residual || 0;
    const isPaid = inv.payment_state === 'paid' || inv.amount_residual === 0;
    
    const dueDateStr = inv.invoice_date_due || inv.invoice_date || '';
    let daysOverdue = 0;
    if (dueDateStr) {
      const dueDate = new Date(dueDateStr);
      if (dueDate < today && !isPaid) {
         const diffTime = Math.abs(today.getTime() - dueDate.getTime());
         daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      }
    }

    let status: 'draft' | 'posted' | 'paid' | 'not_paid' | 'overdue' | 'cancel' = 'not_paid';
    if (inv.state === 'draft') status = 'draft';
    else if (inv.state === 'cancel') status = 'cancel';
    else if (isPaid) status = 'paid';
    else if (daysOverdue > 0) status = 'overdue';
    else status = 'posted';

    return {
      id: inv.id,
      number: inv.name || `INV-MOCK-${inv.id}`,
      customerName: Array.isArray(inv.partner_id) ? inv.partner_id[1] : (inv.partner_id || 'Tanpa Nama'),
      customerEmail: inv._partnerEmail || '',
      date: inv.invoice_date || '',
      dueDate: dueDateStr,
      amountTotal,
      amountResidual,
      status,
      daysOverdue
    };
  });
}

// Resilient Odoo invoice retrieval with fallback fields & model queries for legacy Odoo versions
async function fetchOdooInvoicesDirectly(odoo: OdooConfig): Promise<OdooInvoice[]> {
  const uid = await callOdooRpc(odoo, 'common', 'authenticate', [
    odoo.db, odoo.username, odoo.apiKey, {}
  ]);

  if (!uid) {
    throw new Error('Autentikasi Odoo gagal. Sila periksa username / Password / API Key Odoo Anda.');
  }

  const domain = [
    ['move_type', '=', 'out_invoice'],
    ['state', '=', 'posted']
  ];
  const fields = [
    'name', 'partner_id', 'invoice_date', 'invoice_date_due', 
    'amount_total', 'amount_residual', 'payment_state', 'state'
  ];

  let rawInvoices: any[];
  try {
    rawInvoices = await callOdooRpc(odoo, 'object', 'execute_kw', [
      odoo.db, uid, odoo.apiKey,
      'account.move', 'search_read',
      [domain], { fields }
    ]);
  } catch (queryErr: any) {
    console.warn('First Odoo Invoice read failed, retrying with minimalist fields...', queryErr.message);
    const fallbackFields = [
      'name', 'partner_id', 'invoice_date', 'invoice_date_due', 
      'amount_total', 'amount_residual', 'state'
    ];
    try {
      rawInvoices = await callOdooRpc(odoo, 'object', 'execute_kw', [
        odoo.db, uid, odoo.apiKey,
        'account.move', 'search_read',
        [domain], { fields: fallbackFields }
      ]);
    } catch (fallbackErr: any) {
      console.warn('Minimalist Odoo read failed, attempting legacy account.invoice model...', fallbackErr.message);
      try {
        const legacyDomain = [['type', '=', 'out_invoice'], ['state', '=', 'open']];
        const legacyFields = ['number', 'partner_id', 'date_invoice', 'date_due', 'amount_total', 'residual', 'state'];
        const rawLegacy = await callOdooRpc(odoo, 'object', 'execute_kw', [
          odoo.db, uid, odoo.apiKey,
          'account.invoice', 'search_read',
          [legacyDomain], { fields: legacyFields }
        ]);
        rawInvoices = rawLegacy.map((linv: any) => ({
          id: linv.id,
          name: linv.number || `INV-${linv.id}`,
          partner_id: linv.partner_id,
          invoice_date: linv.date_invoice,
          invoice_date_due: linv.date_due,
          amount_total: linv.amount_total,
          amount_residual: linv.residual,
          state: linv.state
        }));
      } catch (legacyErr: any) {
        throw new Error(`Gagal membaca model 'account.move' (Modern) maupun 'account.invoice' (Legacy): ${legacyErr.message}`);
      }
    }
  }

  // Fetch partner emails separately (dot-notation not supported in search_read)
  try {
    const partnerIds = [...new Set(
      rawInvoices
        .map((inv: any) => Array.isArray(inv.partner_id) ? inv.partner_id[0] : inv.partner_id)
        .filter((id: any) => id && typeof id === 'number')
    )];
    if (partnerIds.length > 0) {
      const partners = await callOdooRpc(odoo, 'object', 'execute_kw', [
        odoo.db, uid, odoo.apiKey,
        'res.partner', 'search_read',
        [[['id', 'in', partnerIds]]],
        { fields: ['id', 'email'] }
      ]);
      const emailMap: Record<number, string> = {};
      for (const p of partners) {
        emailMap[p.id] = p.email || '';
      }
      rawInvoices = rawInvoices.map((inv: any) => ({
        ...inv,
        _partnerEmail: emailMap[Array.isArray(inv.partner_id) ? inv.partner_id[0] : inv.partner_id] || ''
      }));
    }
  } catch (emailErr: any) {
    console.warn('Could not fetch partner emails, continuing without:', emailErr.message);
  }

  return mapOdooInvoices(rawInvoices);
}

// Send actual message to Telegram Bot api
async function sendTelegramMessage(token: string, chatId: string, text: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.description || 'Gagal mengirim pesan bot ke Telegram');
    }
    return result;
  } catch (error: any) {
    console.error('Error sending telegram message:', error);
    throw new Error(error.message || 'Gagal terhubung ke API Telegram');
  }
}

// Helper function to generate a secure, fast, local draft of billing reminder customized by tone
function getLocalBillingReminderDraft(customerName: string, invoices: any[], tone: string): string {
  const unpaidInvoicesText = invoices.map((inv: any) => 
    `- Invoice ${inv.number} (Jatuh tempo: ${inv.dueDate}, Sisa: ${formatIDR(inv.amountResidual)})`
  ).join('\n');

  const totalOutstanding = invoices.reduce((sum: number, inv: any) => sum + inv.amountResidual, 0);
  const totalFormatted = formatIDR(totalOutstanding);

  const cleanTone = (tone || '').toLowerCase();

  if (cleanTone.includes('tegas') || cleanTone.includes('overdue')) {
    return `Kepada Yth. Pimpinan / Tim Finance *${customerName}*,\n\n` +
      `Menindaklanjuti catatan keuangan kami, bersama pesan ini kami sampaikan pemberitahuan penting mengenai adanya tagihan yang telah melewati hari jatuh tempo pembayaran (Overdue).\n\n` +
      `Berikut adalah rincian tagihan overdue yang membutuhkan perhatian mendesak Anda:\n` +
      `${unpaidInvoicesText}\n\n` +
      `*Total Tunggakan:* *${totalFormatted}*\n\n` +
      `Mengingat umur tagihan yang sudah cukup lama, mohon masukan/prioritas dari Bapak/Ibu untuk segera melunasi kewajiban tagihan di atas demi menjaga kesinambungan kerja sama bisnis dan kredit yang baik.\n\n` +
      `Mohon selesaikan pelunasan ke rekening resmi korporat kami:\n` +
      `🏦 *Bank Mandiri*\n` +
      `📌 *No. Rekening:* 123-456-7890-50\n` +
      `📌 *Atas Nama:* PT Solusi Integrasi ERP\n\n` +
      `Harap konfirmasi segera kepada kami jika Anda sudah melakukan pembayaran dengan melampirkan salinan bukti transfer keuangan.\n\n` +
      `Apabila ada kendala pembayaran atau kebutuhan pencocokan data saldo piutang, segera hubungi penanggung jawab kami:\n` +
      `📞 *Staff AR:* 0812-3456-7890\n\n` +
      `Kami sangat menghargai perhatian cepat dan kerja sama kooperatif dari Anda dalam menyelesaikan hal ini.\n\n` +
      `Hormat kami,\n` +
      `*Divisi Accounts Receivable*\n` +
      `*PT Solusi Integrasi ERP*`;
  } else if (cleanTone.includes('kasual') || cleanTone.includes('akrab')) {
    return `Halo Kak *${customerName}*, Apa kabar? Semoga beraktivitas dengan lancar hari ini ya! 😊\n\n` +
      `Kak, kami mau mengonfirmasi titipan tagihan bulanan nih untuk transaksi invoice yang kemarin dipesan. Biar pembukuan kita sama-sama rapi, berikut rincian sisa tagihannya ya:\n\n` +
      `${unpaidInvoicesText}\n\n` +
      `*Total outstanding:* *${totalFormatted}*\n\n` +
      `Kalau sekiranya sudah dijadwalkan bayar, boleh langsung dikirim ke rekening Mandiri kita ya Kak:\n` +
      `🏦 *Bank Mandiri*\n` +
      `📌 *No. Rekening:* 123-456-7890-50\n` +
      `📌 *A/N:* PT Solusi Integrasi ERP\n\n` +
      `Kalau Kakak sudah transfer, jangan lupa info/send bukti transfernya ke kita ya biar bisa langsung kita update lunas di sistem Odoo kita. 👍\n\n` +
      `Jika ada kendala pembayaran atau sekadar mau tanya rincian belanjaan, kontak tim AR kita aja di:\n` +
      `📞 *Staff AR:* 0812-3456-7890 (atau reply chat ini)\n\n` +
      `Makasih banyak atas bantuannya ya Kak! Sehat selalu dan sukses buat usahanya. 🙏 Kak!`;
  } else if (cleanTone.includes('english') || cleanTone.includes('formal (international)')) {
    return `Dear Finance Team at *${customerName}*,\n\n` +
      `I hope this message finds you well.\n\n` +
      `We are writing from the *Accounts Receivable (AR) department of PT Solusi Integrasi ERP* to kindly request an update regarding the outstanding invoices on your account.\n\n` +
      `According to our records, the following invoices remain unpaid:\n` +
      `${unpaidInvoicesText}\n\n` +
      `*Total Outstanding Balance:* *${totalFormatted}*\n\n` +
      `Please kindly arrange for the settlement of these entries to ensure your account remains in good standing.\n\n` +
      `Payments can be wired directly to our official company bank account:\n` +
      `🏦 *Bank Mandiri*\n` +
      `📌 *Account Number:* 123-456-7890-50\n` +
      `📌 *Beneficiary Name:* PT Solusi Integrasi ERP\n\n` +
      `Once the payment is processed, please send us a copy of the bank transfer advice for swift allocation and matching in our ERP ledger.\n\n` +
      `Should you require any documentation (e.g., e-invoices, tax papers) or have any questions, feel free to contact our AR Helpdesk:\n` +
      `📞 *AR Specialist:* +62 812-3456-7890\n\n` +
      `We deeply appreciate your prompt attention and continuous partnership.\n\n` +
      `Best regards,\n` +
      `*Finance & Accounts Receivable Team*\n` +
      `*PT Solusi Integrasi ERP*`;
  } else {
    // Sopan, Ramah, & Profesional (Default)
    return `Halo Bapak/Ibu Finance *${customerName}*,\n\n` +
      `Semoga Bapak/Ibu selalu sehat dan sukses dalam segala usaha. 🙏\n\n` +
      `Kami dari tim *Accounts Receivable (AR) PT Solusi Integrasi ERP* ingin mengonfirmasi dan mengingatkan kembali perihal tagihan berjalan yang masih outstanding (belum lunas) pada sistem kami.\n\n` +
      `Berikut adalah rincian invoice yang belum terselesaikan:\n` +
      `${unpaidInvoicesText}\n\n` +
      `*Total Outstanding:* *${totalFormatted}*\n\n` +
      `Kami mohon kesediaan Bapak/Ibu untuk menjadwalkan pembayaran tagihan tersebut demi kelancaran rekonsiliasi data keuangan antar-perusahaan.\n\n` +
      `Pembayaran dapat ditransfer ke rekening resmi kami:\n` +
      `🏦 *Bank Mandiri*\n` +
      `📌 *No. Rekening:* 123-456-7890-50\n` +
      `📌 *Atas Nama (A/N):* PT Solusi Integrasi ERP\n\n` +
      `Setelah transfer berhasil dilakukan, mohon kirimkan bukti transfer tersebut demi kemandirian alokasi dana tagihan Anda.\n\n` +
      `Jika ada hal yang ingin ditanyakan atau membutuhkan rekonsiliasi/pencocokan data (faktur pajak, dll.), silakan menghubungi kontak person administrasi AR kami:\n` +
      `📞 *Staff AR:* 0812-3456-7890\n\n` +
      `Terima kasih banyak atas kerja sama yang baik dan pengertian Bapak/Ibu selama ini.\n\n` +
      `Salam hangat,\n` +
      `*Tim Finance & AR*\n` +
      `*PT Solusi Integrasi ERP*`;
  }
}

// Generate the Bot response text based on incoming message commands
async function generateBotResponse(commandText: string, config: any): Promise<string> {
  const normText = commandText.trim().toLowerCase();
  
  let invoices: OdooInvoice[] = [];
  if (config.simulationMode || !config.odoo.url) {
    invoices = SIMULATED_INVOICES;
  } else {
    try {
      invoices = await fetchOdooInvoicesDirectly(config.odoo);
    } catch (e: any) {
       return `⚠️ <b>Error Koneksi Odoo ERP:</b>\n${e.message}\n\n<i>Menggunakan data simulasi karena kegagalan koneksi.</i>`;
    }
  }

  if (normText === '/start' || normText.includes('start')) {
    return `👋 <b>Halo Staff AR!</b>\n\nSelamat datang di <b>Asisten Odoo ERP AR Telegram Bot</b>.\n\nBot ini tersambung ke Odoo Accounting Anda untuk membantu memantau tagihan, merangkum piutang overdue, aging, serta menyusun draf penagihan.\n\n<b>Daftar Perintah (Commands):</b>\n` +
      `📁 /outstanding - Daftar seluruh invoice belum lunas\n` +
      `🚨 /overdue - Daftar invoice yang sudah jatuh tempo\n` +
      `📊 /aging - Laporan umur piutang (Aging AR)\n` +
      `👤 /customer - Ringkasan outstanding per pelanggan\n` +
      `✍️ /remind [nama_customer] - Buat draf penagihan ramah via AI\n` +
      `📈 /summary - Ringkasan cepat posisi Piutang (AR)\n\n` +
      `<i>Hubungi Admin / AR Supervisor untuk integrasi lebih lanjut.</i>`;
  }

  if (normText === '/summary' || normText.includes('summary')) {
    const totalAR = invoices.reduce((acc, inv) => acc + inv.amountResidual, 0);
    const unpaidList = invoices.filter(inv => inv.amountResidual > 0);
    const overdueList = unpaidList.filter(inv => inv.daysOverdue > 0);
    const totalOverdue = overdueList.reduce((acc, inv) => acc + inv.amountResidual, 0);
    return `📈 <b>Ringkasan Piutang (AR) - Odoo ERP</b>\n` +
      `📅 Per Tanggal: <b>${new Date().toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'})}</b>\n\n` +
      `• Total Piutang Aktif: <b>${formatIDR(totalAR)}</b>\n` +
      `• Invoice Belum Lunas: <b>${unpaidList.length} Invoice</b>\n` +
      `• Invoice Overdue (Jatuh Tempo): <b>${overdueList.length} Invoice</b>\n` +
      `• Total Overdue: <pre>${formatIDR(totalOverdue)}</pre>\n\n` +
      `🚀 Silakan kirim /outstanding untuk melihat rincian atau /aging untuk melihat pengelompokan umur penagihan.`;
  }

  if (normText === '/outstanding' || normText.includes('outstanding')) {
    const outstanding = invoices.filter(inv => inv.amountResidual > 0);
    if (outstanding.length === 0) {
      return `🎉 <b>Selamat!</b> Tidak ada invoice outstanding saat ini. Semua tagihan telah terlunasi.`;
    }
    let response = `📁 <b>Daftar Invoice Outstanding Odoo ERP (${outstanding.length})</b>\n\n`;
    response += outstanding.slice(0, 10).map((inv, idx) => {
      const statusText = inv.daysOverdue > 0 ? `🛑 Overdue ${inv.daysOverdue} hari` : `⏳ Jatuh tempo ${inv.dueDate}`;
      return `${idx + 1}. <b>${inv.number}</b> - ${inv.customerName}\n` +
             `   • Nominal Sisa: <b>${formatIDR(inv.amountResidual)}</b> dari ${formatIDR(inv.amountTotal)}\n` +
             `   • Status: ${statusText}\n`;
    }).join('\n');
    if (outstanding.length > 10) {
      response += `\n<i>...dan ${outstanding.length - 10} invoice lainnya dapat diakses di Odoo ERP.</i>`;
    }
    return response;
  }

  if (normText === '/overdue' || normText.includes('overdue')) {
    const overdue = invoices.filter(inv => inv.amountResidual > 0 && inv.daysOverdue > 0);
    if (overdue.length === 0) {
       return `✅ <b>Kabar Baik!</b> Tidak ada invoice yang berstatus Overdue. Pekerjaan AR yang sangat baik!`;
    }
    let response = `🚨 <b>Invoice Overdue Terdeteksi (${overdue.length} Tagihan)</b>\n\n`;
    response += overdue.slice(0, 8).map((inv, idx) => {
      return `${idx + 1}. <b>${inv.number}</b>\n` +
             `   • Customer: <b>${inv.customerName}</b>\n` +
             `   • Nominal: <b>${formatIDR(inv.amountResidual)}</b>\n` +
             `   • Terlambat: <b>${inv.daysOverdue} Hari</b> (Jth Tempo: ${inv.dueDate})\n`;
    }).join('\n');
    if (overdue.length > 8) {
       response += `\n<i>...dan ${overdue.length - 8} tagihan overdue lainnya.</i>`;
    }
    return response;
  }

  if (normText === '/aging' || normText.includes('aging')) {
    let bucket_1 = 0, bucket_2 = 0, bucket_3 = 0, bucket_4 = 0, current = 0;
    invoices.forEach(inv => {
      if (inv.amountResidual <= 0) return;
      if (inv.daysOverdue === 0) current += inv.amountResidual;
      else if (inv.daysOverdue <= 30) bucket_1 += inv.amountResidual;
      else if (inv.daysOverdue <= 60) bucket_2 += inv.amountResidual;
      else if (inv.daysOverdue <= 90) bucket_3 += inv.amountResidual;
      else bucket_4 += inv.amountResidual;
    });
    const total = current + bucket_1 + bucket_2 + bucket_3 + bucket_4;
    return `📊 <b>AR Aging Report - Umur Piutang Odoo</b>\n` +
      `📅 Per Tanggal: ${new Date().toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'})}\n\n` +
      `• Belum Jth Tempo: <b>${formatIDR(current)}</b>\n` +
      `• Overdue 1-30 Hari: <b>${formatIDR(bucket_1)}</b>\n` +
      `• Overdue 31-60 Hari: <b>${formatIDR(bucket_2)}</b>\n` +
      `• Overdue 61-90 Hari: <b>${formatIDR(bucket_3)}</b>\n` +
      `• Overdue >90 Hari: <b>${formatIDR(bucket_4)}</b>\n\n` +
      `💰 <b>Total Piutang Outstanding: ${formatIDR(total)}</b>\n\n` +
      `💡 <i>Kirim perintah /overdue untuk memproses invoice yang sudah jatuh tempo.</i>`;
  }

  if (normText === '/customer' || normText.includes('customer')) {
    const outstanding = invoices.filter(inv => inv.amountResidual > 0);
    const partnersMap: { [key: string]: { count: number; original: number; remaining: number } } = {};
    outstanding.forEach(inv => {
      if (!partnersMap[inv.customerName]) partnersMap[inv.customerName] = { count: 0, original: 0, remaining: 0 };
      partnersMap[inv.customerName].count++;
      partnersMap[inv.customerName].original += inv.amountTotal;
      partnersMap[inv.customerName].remaining += inv.amountResidual;
    });
    const sortedCustomers = Object.entries(partnersMap).sort((a,b) => b[1].remaining - a[1].remaining);
    if (sortedCustomers.length === 0) return `👤 <b>Customer Outstanding</b>\n\nTidak ada daftar piutang per pelanggan.`;
    let response = `👤 <b>Tagihan Outstanding per Customer</b>\n\n`;
    response += sortedCustomers.slice(0, 10).map(([name, data], idx) =>
       `${idx + 1}. <b>${name}</b>\n   • ${data.count} Invoice aktif | Total Piutang: <b>${formatIDR(data.remaining)}</b>\n`
    ).join('\n');
    return response;
  }

  if (normText.startsWith('/remind') || normText.includes('remind')) {
    const query = commandText.substring(7).trim();
    if (!query) {
      return `✍️ <b>Penggunaan /remind:</b>\nKetik <code>/remind [nama_customer]</code>\n\nContoh: <code>/remind CV Sumber Makmur</code>`;
    }
    const matchInvoices = invoices.filter(inv => 
      inv.amountResidual > 0 && inv.customerName.toLowerCase().includes(query.toLowerCase())
    );
    if (matchInvoices.length === 0) {
      return `❌ Pelanggan atau tagihan aktif untuk "<b>${query}</b>" tidak ditemukan.\n\nKetik /outstanding untuk melihat daftar pelanggan.`;
    }
    const customerName = matchInvoices[0].customerName;
    const finalDraft = getLocalBillingReminderDraft(customerName, matchInvoices, 'default');
    return `✍️ <b>DRAF PENAGIHAN (Lokal & Aman) untuk ${customerName}</b>\n\n${finalDraft}`;
  }

  return `❓ Perintah tidak dikenali.\n\nKetik /start untuk melihat panduan perintah bot.`;
}

// REST APIs
app.get('/api/config', (req, res) => { res.json(activeConfig); });

app.post('/api/config', (req, res) => {
  const odoo = req.body.odoo ? {
    url: (req.body.odoo.url || '').trim(),
    db: (req.body.odoo.db || '').trim(),
    username: (req.body.odoo.username || '').trim(),
    apiKey: (req.body.odoo.apiKey || '').trim()
  } : activeConfig.odoo;
  const telegram = req.body.telegram ? {
    botToken: (req.body.telegram.botToken || '').trim(),
    chatId: (req.body.telegram.chatId || '').trim(),
    isActive: !!req.body.telegram.botToken
  } : activeConfig.telegram;
  activeConfig = { ...activeConfig, odoo, telegram, simulationMode: req.body.simulationMode !== undefined ? req.body.simulationMode : activeConfig.simulationMode };
  saveConfig(activeConfig);
  res.json({ status: 'success', config: activeConfig });
});

app.post('/api/odoo/validate', async (req, res) => {
  const url = (req.body.url || '').trim();
  const db = (req.body.db || '').trim();
  const username = (req.body.username || '').trim();
  const apiKey = (req.body.apiKey || '').trim();
  if (!url || !db || !username || !apiKey) {
    return res.status(400).json({ error: 'Seluruh parameter Odoo kredensial wajib diisi' });
  }
  try {
    const uid = await callOdooRpc({ url, db, username, apiKey }, 'common', 'authenticate', [db, username, apiKey, {}]);
    if (uid) res.json({ success: true, uid });
    else res.status(401).json({ error: 'Otorisasi Odoo gagal. Cek username/password' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memvalidasi koneksi Odoo' });
  }
});

app.post('/api/odoo/invoices', async (req, res) => {
  if (req.body.simulationMode) return res.json(SIMULATED_INVOICES);
  const odooRaw = req.body.odoo;
  if (!odooRaw || !odooRaw.url || !odooRaw.db || !odooRaw.username || !odooRaw.apiKey) {
    return res.status(400).json({ error: 'Kredensial Odoo tidak didefinisikan untuk penarikan data riil' });
  }
  const odoo = { url: (odooRaw.url||'').trim(), db: (odooRaw.db||'').trim(), username: (odooRaw.username||'').trim(), apiKey: (odooRaw.apiKey||'').trim() };
  try {
    const mapped = await fetchOdooInvoicesDirectly(odoo);
    res.json(mapped);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal membaca tagihan dari Odoo ERP' });
  }
});

app.post('/api/telegram/register-webhook', async (req, res) => {
  const { botToken } = req.body;
  if (!botToken) return res.status(400).json({ error: 'Token Bot Telegram wajib diisi' });
  const appUrl = process.env.APP_URL || `https://ais-pre-p36hymp5wvrbuhjdeicldr-995418568429.asia-southeast1.run.app`;
  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/telegram-webhook`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.description || 'Gagal mendaftarkan webhook Telegram');
    botLogs.push({ id: `system_${Date.now()}`, timestamp: new Date().toISOString(), type: 'system', sender: 'Sistem', message: 'Webhook Telegram terdaftar.', details: `Target: ${webhookUrl}` });
    res.json({ success: true, description: data.description, webhookUrl });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal mendaftarkan webhook ke Telegram API' });
  }
});

app.post('/api/telegram/send-test', async (req, res) => {
  const { botToken, chatId, message } = req.body;
  if (!botToken || !chatId || !message) return res.status(400).json({ error: 'Mohon isi Token, Chat ID, dan pesan teks tes' });
  try {
    await sendTelegramMessage(botToken, chatId, message);

    botLogs.push({
      id: `out_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'outgoing',
      sender: `Bot (ke Chat ${chatId})`,
      message: message,
      details: 'Pesan tes berhasil terkirim melalui Telegram API langsung.'
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal mengirim pesan tes' });
  }
});

// Real Webhook receiver from Telegram Server
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  console.log('Incoming Telegram Update:', JSON.stringify(update));

  if (!update || !update.message) {
    return res.sendStatus(200);
  }

  const message = update.message;
  const text = message.text || '';
  const chatId = message.chat ? String(message.chat.id) : '';
  const username = message.from ? (message.from.username || message.from.first_name || 'User') : 'User';

  botLogs.push({
    id: `in_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'incoming',
    sender: `Telegram User (${username})`,
    message: text,
    details: `Sourced Chat ID: ${chatId}`
  });

  // Calculate reply response based on Odoo config
  try {
    const config = activeConfig;
    const responseText = await generateBotResponse(text, config);

    // Call back via Telegram API if credentials exist
    if (config.telegram.botToken && chatId) {
      await sendTelegramMessage(config.telegram.botToken, chatId, responseText);
      botLogs.push({
        id: `out_reply_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'outgoing',
        sender: 'Bot',
        message: responseText,
        details: `Terkirim otomatis ke Chat ID: ${chatId}`
      });
    }

    res.sendStatus(200);
  } catch (err: any) {
    console.error('Webhook reply processing failed:', err);
    res.sendStatus(200); // Always answer OK to telegram avoiding retry loop
  }
});

// Simulated In-App chat box engine so users can "Play" and "Chat" inside the UI Sandbox
app.post('/api/telegram/sandbox-chat', async (req, res) => {
  const { text, username } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  // Log incoming sandbox message
  const inLog: BotLog = {
    id: `sandbox_in_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'incoming',
    sender: username || 'User (Sandbox)',
    message: text
  };
  botLogs.push(inLog);

  try {
    const responseText = await generateBotResponse(text, activeConfig);

    const outLog: BotLog = {
      id: `sandbox_out_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'outgoing',
      sender: 'Odoo AR Bot (Assistant)',
      message: responseText
    };
    botLogs.push(outLog);

    res.json({
      incoming: inLog,
      reply: outLog
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Log endpoints
app.get('/api/bot/logs', (req, res) => {
  res.json(botLogs.slice(-50).reverse()); // Return last 50 logs, newest first
});

app.post('/api/bot/clear-logs', (req, res) => {
  botLogs = [
    {
      id: `system_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'system',
      sender: 'Sistem',
      message: 'Log dibersihkan oleh pengguna.'
    }
  ];
  res.json({ success: true });
});

// Generate dynamic reminder drafts in Applet Dashboard via manual UI trigger
app.post('/api/gemini/generate-reminder', (req, res) => {
  const { customerName, invoices, tone } = req.body;
  if (!customerName || !invoices || invoices.length === 0) {
    return res.status(400).json({ error: 'Data pelangan dan rincian invoice wajib dicantumkan.' });
  }

  try {
    const text = getLocalBillingReminderDraft(customerName, invoices, tone);
    res.json({ text });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memproses draf local' });
  }
});

// Boot dev server or bind to index.html in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
  });
}

startServer();