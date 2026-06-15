/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  apiKey: string; // Password or API Key
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  isActive: boolean;
}

export interface AppConfig {
  odoo: OdooConfig;
  telegram: TelegramConfig;
  simulationMode: boolean;
}

export type InvoiceStatus = 'draft' | 'posted' | 'paid' | 'not_paid' | 'overdue' | 'cancel';

export interface OdooInvoice {
  id: number;
  number: string;
  customerName: string;
  customerEmail: string;
  date: string;
  dueDate: string;
  amountTotal: number;
  amountResidual: number;
  status: InvoiceStatus;
  daysOverdue: number;
}

export interface CustomerOutstanding {
  customerName: string;
  totalInvoiceCount: number;
  outstandingCount: number;
  originalAmount: number;
  remainingAmount: number;
  oldestInvoiceDate: string;
}

export interface BotLog {
  id: string;
  timestamp: string;
  type: 'incoming' | 'outgoing' | 'error' | 'system';
  sender: string;
  message: string;
  details?: string;
}

export interface TelegramCommand {
  command: string;
  description: string;
  parameters?: string;
  useCase: string;
}
