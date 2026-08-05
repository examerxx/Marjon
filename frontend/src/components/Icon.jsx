import {
  Activity, AlertTriangle, Archive, ArrowLeft, ArrowLeftRight, ArrowRightLeft,
  ArrowUp, BarChart, BarChart2, Bell, Box, Boxes, Building2, CalendarCheck,
  Calendar, Camera, Check, CheckCircle, CheckCircle2, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, Circle, CircleArrowDown, CircleArrowUp, Clock,
  ClipboardCheck, ClipboardList, Coffee, Coins, Columns2, Combine, Contact2, CornerDownLeft,
  CreditCard, Delete, Download, Droplet, Egg, Eye, EyeOff, FileBarChart, FileSpreadsheet,
  FilePlus, FileText, Filter, Gauge, Gift, Grid3X3, Hash, Headphones,
  History, Image, Info, Languages, LayoutGrid, LayoutPanelTop, LifeBuoy,
  ListChecks, ListOrdered, Lock, LogOut, MapPin, MessageCircle, MessageSquare,
  Minus, Monitor, MoreHorizontal, OctagonX, Package, PackageCheck, PackageOpen,
  Pencil, Phone, PieChart, PlusCircle, Plus, Printer, QrCode, Receipt,
  RefreshCcw, RefreshCw, RotateCcw, RotateCw, Ruler, Search, Send, Settings, Settings2,
  ShieldCheck, ShieldX, ShoppingBasket, SlidersHorizontal, Sparkles, Store,
  Tags, Timer, TrendingDown, TrendingUp, Trash2, Upload, User, UserCog, UserPlus,
  Users, Wallet, Wifi, WifiOff, X, Zap, PanelLeft, GitFork, Scissors,
  FileCheck, Banknote, BookOpen, Landmark, Layers, Kanban, Megaphone, Star,
  Inbox
} from 'lucide-react'

function SidebarCollapseIcon({ size = 16, strokeWidth = 3.2, className, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      focusable="false"
    >
      <path d="M6 6.5H26" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M19 13H26" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M19 19H26" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M6 25.5H26" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M14.5 12L7.5 16L14.5 20V12Z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const ICON_MAP = {
  /* ── Navigation ─────────────────── */
  'bi-arrow-left':             ArrowLeft,
  'bi-arrow-left-right':       ArrowLeftRight,
  'bi-arrow-return-left':      CornerDownLeft,
  'bi-arrow-up-short':         ArrowUp,
  'bi-arrow-repeat':           RefreshCw,
  'bi-arrow-counterclockwise': RotateCcw,
  'bi-arrow-clockwise':        RotateCw,
  'bi-arrow-down-left-circle': CircleArrowDown,
  'bi-arrow-up-right-circle':  CircleArrowUp,
  'bi-chevron-down':           ChevronDown,
  'bi-chevron-left':           ChevronLeft,
  'bi-chevron-right':          ChevronRight,
  'bi-chevron-up':             ChevronUp,
  'bi-caret-down-fill':        ChevronDown,
  'bi-caret-up-fill':          ChevronUp,
  'bi-box-arrow-right':        LogOut,
  'bi-box-arrow-in-down':      PackageOpen,
  'bi-box-arrow-up':           PackageCheck,
  'bi-download':               Download,
  'bi-upload':                 Upload,

  /* ── UI / Actions ───────────────── */
  'bi-search':                 Search,
  'bi-x-lg':                   X,
  'bi-plus':                   Plus,
  'bi-plus-lg':                Plus,
  'bi-dash-lg':                Minus,
  'bi-plus-circle':            PlusCircle,
  'bi-three-dots':             MoreHorizontal,
  'bi-sliders':                SlidersHorizontal,
  'bi-pencil-square':          Pencil,
  'bi-copy':                   ClipboardList,
  'bi-chat-square':            MessageSquare,
  'bi-chat-square-text-fill':  MessageSquare,
  'bi-hourglass-split':        Timer,
  'bi-send':                   Send,
  'bi-bell':                   Bell,
  'bi-backspace':              Delete,
  'bi-eye':                    Eye,
  'bi-eye-slash':              EyeOff,
  'bi-sort-down':              ListOrdered,
  'bi-layout-sidebar-inset':   PanelLeft,
  'bi-sidebar-collapse':       SidebarCollapseIcon,
  'bi-layout-wtf':             LayoutPanelTop,

  /* ── Status / Alerts ────────────── */
  'bi-check2':                 Check,
  'bi-check-circle':           CheckCircle,
  'bi-check2-circle':          CheckCircle2,
  'bi-info-circle':            Info,
  'bi-exclamation-triangle':   AlertTriangle,
  'bi-circle':                 Circle,
  'bi-activity':               Activity,
  'bi-life-preserver':         LifeBuoy,
  'bi-inbox':                  Inbox,

  /* ── People / Auth ──────────────── */
  'bi-person':                 User,
  'bi-people':                 Users,
  'bi-person-gear':            UserCog,
  'bi-person-plus':            UserPlus,
  'bi-person-badge':           FileCheck,
  'bi-person-lines-fill':      ClipboardList,
  'bi-person-vcard':           Contact2,
  'bi-shield-fill-check':      ShieldCheck,
  'bi-shield-check':           ShieldCheck,
  'bi-shield-lock':            ShieldX,
  'bi-lock':                   Lock,

  /* ── Finance ────────────────────── */
  'bi-cash-stack':             Banknote,
  'bi-cash-coin':              Coins,
  'bi-wallet2':                Wallet,
  'bi-credit-card':            CreditCard,
  'bi-credit-card-2-front':    CreditCard,
  'bi-receipt':                Receipt,
  'bi-receipt-cutoff':         Scissors,
  'bi-currency-exchange':      ArrowRightLeft,
  'bi-intersect':              Combine,
  'bi-pie-chart':              PieChart,

  /* ── Charts / Reports ───────────── */
  'bi-graph-up':               TrendingUp,
  'bi-graph-up-arrow':         TrendingUp,
  'bi-graph-down':             TrendingDown,
  'bi-bar-chart':              BarChart,
  'bi-bar-chart-line':         BarChart2,
  'bi-file-earmark-bar-graph': FileBarChart,
  'bi-file-earmark-spreadsheet': FileSpreadsheet,
  'bi-journal-plus':           FilePlus,
  'bi-journal-text':           FileText,
  'bi-stars':                  Sparkles,
  'bi-tags':                   Tags,
  'bi-list-check':             ListChecks,
  'bi-funnel':                 Filter,
  'bi-123':                    Hash,
  'bi-calendar3':              Calendar,
  'bi-calendar-check':         CalendarCheck,
  'bi-clock':                  Clock,
  'bi-clock-history':          History,
  'bi-stopwatch':              Timer,

  /* ── Warehouse / Products ───────── */
  'bi-box':                    Box,
  'bi-boxes':                  Boxes,
  'bi-box-seam':               Package,
  'bi-basket':                 ShoppingBasket,
  'bi-archive':                Archive,
  'bi-egg-fried':              Egg,
  'bi-cup-hot':                Coffee,
  'bi-rulers':                 Ruler,
  'bi-droplet':                Droplet,
  'bi-speedometer2':           Gauge,
  'bi-grid':                   LayoutGrid,
  'bi-grid-3x3-gap':           Grid3X3,
  'bi-diagram-3':              GitFork,

  /* ── Communication ──────────────── */
  'bi-chat-left':              MessageSquare,
  'bi-chat-dots':              MessageCircle,
  'bi-headset':                Headphones,
  'bi-telephone':              Phone,
  'bi-translate':              Languages,
  'bi-wifi':                   Wifi,
  'bi-wifi-off':               WifiOff,

  /* ── Media / Interface ──────────── */
  'bi-image':                  Image,
  'bi-camera':                 Camera,
  'bi-printer':                Printer,
  'bi-printer-fill':           Printer,
  'bi-qr-code':                QrCode,
  'bi-card-heading':           CreditCard,
  'bi-columns-gap':            Columns2,
  'bi-pencil':                 Pencil,
  'bi-trash3':                 Trash2,
  'bi-x-octagon':              OctagonX,
  'bi-gear-wide-connected':    Settings2,
  'bi-gift':                   Gift,

  /* ── Places / Business ──────────── */
  'bi-shop':                   Store,
  'bi-building':               Building2,
  'bi-pc-display':             Monitor,
  'bi-display':                Monitor,
  'bi-lightning-charge-fill':  Zap,
  'bi-arrow-up-right-circle':  CircleArrowUp,

  /* ── Extra ───────────────────────── */
  'bi-clipboard-check':        ClipboardCheck,
  'bi-recycle':                RefreshCcw,
  'bi-gear':                   Settings,
  'bi-person-fill':            User,
  'bi-geo-alt':                MapPin,
  'bi-bank':                   Landmark,
  'bi-buildings':              Building2,
  'bi-collection':             Layers,
  'bi-grid-1x2-fill':         LayoutGrid,
  'bi-journal-bookmark':       BookOpen,
  'bi-kanban':                 Kanban,
  'bi-megaphone':              Megaphone,
  'bi-star':                   Star,
}

export default function Icon({ name, size = 16, strokeWidth, className, style }) {
  const Component = ICON_MAP[name]
  if (!Component) return null
  return <Component size={size} strokeWidth={strokeWidth} className={className} style={style} />
}
