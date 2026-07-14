import React, { useEffect, useState, useMemo, useRef } from 'react';
import { db, auth } from '../firebase';
import { collection, doc, query, onSnapshot, orderBy, setDoc } from 'firebase/firestore';
import {
  DailyReport,
  UserProfile,
  CategoryId,
  getAuthorizedAgent,
  getReportCategoryValue,
} from '../constants';
import {
  ReportCategory,
  getReportCategoryIcon,
  useReportCategories,
} from '../reportCatalog';
import { 
  Users, 
  BarChart3, 
  ChevronRight, 
  LogOut, 
  TrendingUp,
  Filter,
  Download,
  LayoutDashboard,
  History,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  AlertTriangle,
  RefreshCw,
  Megaphone,
  Target,
  ClipboardList,
} from 'lucide-react';
import { FileUp, PhoneCall } from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  LineChart,
  Line
} from 'recharts';
import { formatDate, getItalyDate, cn } from '../lib/utils';
import { 
  format, 
  subDays, 
  isSameDay, 
  parseISO, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval,
  eachDayOfInterval,
  subMonths
} from 'date-fns';
import { it } from 'date-fns/locale';
import AdminImportPanel from './AdminImportPanel';
import AdminCallCenter from './AdminCallCenter';
import AdminDailyObjectives from './AdminDailyObjectives';
import AdminReportCategories from './AdminReportCategories';
import AdminNotices from './AdminNotices';
import { downloadCSV, escapeCSVCell } from '../lib/csv';

type Tab =
  | 'overview'
  | 'dettaglio_fl'
  | 'storico'
  | 'rendicontazione'
  | 'obiettivi'
  | 'avvisi'
  | 'chiamate'
  | 'importazioni';
type TimeRange = 'day' | 'week' | 'month' | 'custom';

export default function AdminDashboard() {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTab, setSelectedTab] = useState<Tab>('overview');
  
  // Filters
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [startDate, setStartDate] = useState<string>(() => getItalyDate());
  const [endDate, setEndDate] = useState<string>(() => getItalyDate());
  
  // Comparison states
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedCategoriesFL, setSelectedCategoriesFL] = useState<CategoryId[]>([
    'incassi',
    'prevMotorSe',
    'emissMotorSe',
    'prevRetailSe',
    'emissRetailSe',
  ]);
  const [selectedCategoriesStorico, setSelectedCategoriesStorico] = useState<CategoryId[]>(['incassi']);
  const employeeSelectionInitializedRef = useRef(false);
  const { categories, sections, loading: categoriesLoading } = useReportCategories();

  useEffect(() => {
    if (categories.length === 0) return;

    const availableIds = new Set(categories.map(category => category.id));
    const keepAvailable = (selected: CategoryId[]) => {
      const valid = selected.filter(categoryId => availableIds.has(categoryId));
      return valid.length > 0 ? valid : [categories[0].id];
    };

    setSelectedCategoriesFL(keepAvailable);
    setSelectedCategoriesStorico(keepAvailable);
  }, [categories]);

  useEffect(() => {
    const q = query(collection(db, 'daily_reports'), orderBy('date', 'desc'));
    const unsubscribeReports = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DailyReport));
      setReports(data);
      setError('');
      setLoading(false);
    }, (reportsError) => {
      console.error('Error loading reports:', reportsError);
      setError(getAdminErrorMessage(reportsError));
      setLoading(false);
    });

    const unsubscribeUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as UserProfile);
      const synchronizedUsers = data.map(user => {
        const authorizedAgent = getAuthorizedAgent(user.email);
        return authorizedAgent
          ? { ...user, name: authorizedAgent.name, role: 'admin' as const }
          : user;
      });
      const profilesToUpdate = synchronizedUsers.filter((user, index) => {
        const original = data[index];
        return original.name !== user.name || original.role !== user.role;
      });

      if (profilesToUpdate.length > 0) {
        Promise.all(
          profilesToUpdate.map(profile =>
            setDoc(doc(db, 'users', profile.uid), profile)
          )
        ).catch(syncError => {
          console.error('Error synchronizing authorized agents:', syncError);
        });
      }

      const employees = synchronizedUsers.filter(u => u.role === 'employee');
      setUsers(employees);
      if (!employeeSelectionInitializedRef.current) {
        setSelectedEmployees(employees.map(e => e.uid));
        employeeSelectionInitializedRef.current = true;
      }
    }, (usersError) => {
      console.error('Error loading users:', usersError);
      setError(getAdminErrorMessage(usersError));
      setLoading(false);
    });

    return () => {
      unsubscribeReports();
      unsubscribeUsers();
    };
  }, []);

  // Filtered reports based on date range
  const filteredReports = useMemo(() => {
    let start = parseISO(startDate);
    let end = parseISO(endDate);

    if (timeRange === 'day') {
      end = start;
    } else if (timeRange === 'week') {
      start = startOfWeek(start, { weekStartsOn: 1 });
      end = endOfWeek(start, { weekStartsOn: 1 });
    } else if (timeRange === 'month') {
      start = startOfMonth(start);
      end = endOfMonth(start);
    }

    return reports.filter(r => {
      const reportDate = parseISO(r.date);
      return isWithinInterval(reportDate, { start, end });
    });
  }, [reports, startDate, endDate, timeRange]);

  // Overview Data (Cards)
  const categoryTotals = useMemo(() => {
    return categories.map(cat => {
      const total = filteredReports.reduce(
        (sum, report) => sum + getReportCategoryValue(report, cat.id),
        0
      );
      return { ...cat, total };
    });
  }, [categories, filteredReports]);

  // Employee Comparison Data
  const employeeComparisonData = useMemo(() => {
    return selectedEmployees.map(uid => {
      const user = users.find(u => u.uid === uid);
      const userReports = filteredReports.filter(r => r.userId === uid);
      const data: any = { name: user?.name || 'Sconosciuto' };
      
      categories.forEach(cat => {
        data[cat.id] = userReports.reduce(
          (sum, report) => sum + getReportCategoryValue(report, cat.id),
          0
        );
      });
      
      return data;
    });
  }, [categories, filteredReports, selectedEmployees, users]);

  const employeeActivitySummaryRows = useMemo(() => {
    return employeeComparisonData.flatMap(employee => {
      const selectedRows = selectedCategoriesFL.map(categoryId => {
        const category = categories.find(item => item.id === categoryId);
        return {
          employeeName: employee.name as string,
          categoryId,
          category,
          value: Number(employee[categoryId] || 0),
        };
      });

      const total = selectedRows.reduce((sum, row) => sum + row.value, 0);

      return selectedRows.map(row => ({
        ...row,
        employeeTotal: total,
      }));
    });
  }, [categories, employeeComparisonData, selectedCategoriesFL]);

  // History Comparison Data (Activity vs Activity)
  const historyComparisonData = useMemo(() => {
    let start = parseISO(startDate);
    let end = parseISO(endDate);
    
    if (timeRange === 'day') end = start;
    if (timeRange === 'week') { start = startOfWeek(start, { weekStartsOn: 1 }); end = endOfWeek(start, { weekStartsOn: 1 }); }
    if (timeRange === 'month') { start = startOfMonth(start); end = endOfMonth(start); }

    const days = eachDayOfInterval({ start, end });
    
    return days.map(day => {
      const dateStr = formatDate(day);
      const dayReports = filteredReports.filter(r => r.date === dateStr);
      const data: any = { 
        date: format(day, 'dd/MM'),
        fullDate: dateStr
      };
      
      selectedCategoriesStorico.forEach(catId => {
        data[catId] = dayReports.reduce(
          (sum, report) => sum + getReportCategoryValue(report, catId),
          0
        );
      });
      
      return data;
    });
  }, [filteredReports, selectedCategoriesStorico, startDate, endDate, timeRange]);

  // Employee Totals for Overview
  const employeeTotals = useMemo(() => {
    return users.map(user => {
      const userReports = filteredReports.filter(r => r.userId === user.uid);
      const totals: any = {};
      let grandTotal = 0;
      
      categories.forEach(cat => {
        const val = userReports.reduce(
          (sum, report) => sum + getReportCategoryValue(report, cat.id),
          0
        );
        totals[cat.id] = val;
        grandTotal += val;
      });
      
      return {
        ...user,
        totals,
        grandTotal
      };
    }).sort((a, b) => b.grandTotal - a.grandTotal);
  }, [categories, filteredReports, users]);

  const agencyTotal = useMemo(
    () => categoryTotals.reduce((sum, category) => sum + category.total, 0),
    [categoryTotals]
  );

  const activeCategoryCount = useMemo(
    () => categoryTotals.filter(category => category.total > 0).length,
    [categoryTotals]
  );

  const activeEmployeeCount = useMemo(
    () => employeeTotals.filter(employee => employee.grandTotal > 0).length,
    [employeeTotals]
  );

  const periodLabel = useMemo(() => {
    const start = parseISO(startDate);
    const end = parseISO(endDate);

    if (timeRange === 'day') return format(start, 'dd MMM yyyy', { locale: it });
    if (timeRange === 'week') {
      const weekStart = startOfWeek(start, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(start, { weekStartsOn: 1 });
      return `${format(weekStart, 'dd MMM', { locale: it })} - ${format(weekEnd, 'dd MMM yyyy', { locale: it })}`;
    }
    if (timeRange === 'month') return format(start, 'MMMM yyyy', { locale: it });

    return `${format(start, 'dd MMM', { locale: it })} - ${format(end, 'dd MMM yyyy', { locale: it })}`;
  }, [endDate, startDate, timeRange]);

  const exportToCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    
    if (selectedTab === 'overview') {
      csvContent += "Categoria,Totale\n";
      categoryTotals.forEach(cat => {
        csvContent += `${cat.label},${cat.total}\n`;
      });
    } else if (selectedTab === 'dettaglio_fl') {
      const headers = ["Dipendente", ...selectedCategoriesFL.map(id => categories.find(c => c.id === id)?.label)];
      csvContent += headers.join(",") + "\n";
      employeeComparisonData.forEach(emp => {
        const row = [emp.name, ...selectedCategoriesFL.map(id => emp[id] || 0)];
        csvContent += row.join(",") + "\n";
      });
    } else {
      const headers = ["Data", ...selectedCategoriesStorico.map(id => categories.find(c => c.id === id)?.label)];
      csvContent += headers.join(",") + "\n";
      historyComparisonData.forEach(day => {
        const row = [day.fullDate, ...selectedCategoriesStorico.map(id => day[id] || 0)];
        csvContent += row.join(",") + "\n";
      });
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `mancinigroup_export_${selectedTab}_${getItalyDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportHistoryBySourceCSV = () => {
    const headers = [
      'Data',
      'Fonte',
      'Email',
      ...sections.flatMap(section =>
        section.categories.map(category => `${section.title} - ${category.label}`)
      ),
      'Totale giornaliero',
    ];

    const rows = [...filteredReports]
      .sort((first, second) => {
        const dateComparison = first.date.localeCompare(second.date);
        if (dateComparison !== 0) return dateComparison;

        const firstName = users.find(user => user.uid === first.userId)?.name || first.userName;
        const secondName = users.find(user => user.uid === second.userId)?.name || second.userName;
        return firstName.localeCompare(secondName, 'it');
      })
      .map(report => {
        const user = users.find(item => item.uid === report.userId);
        const categoryValues = categories.map(category =>
          getReportCategoryValue(report, category.id)
        );
        const dailyTotal = categoryValues.reduce((sum, value) => sum + value, 0);

        return [
          format(parseISO(report.date), 'dd/MM/yyyy'),
          user?.name || report.userName || 'Sconosciuto',
          user?.email || '',
          ...categoryValues,
          dailyTotal,
        ];
      });

    const csv = [headers, ...rows]
      .map(row => row.map(value => escapeCSVCell(value)).join(';'))
      .join('\r\n');

    downloadCSV(
      csv,
      `mancinigroup_storico_fonte_giorno_${getItalyDate()}.csv`
    );
  };

  if (loading || categoriesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-12 h-12 text-[#003781] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center">
          <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="text-red-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Dashboard non disponibile</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center justify-center gap-2 w-full bg-[#003781] text-white py-3 rounded-xl font-semibold hover:bg-[#002a63] transition-colors"
          >
            <RefreshCw size={20} />
            Riprova
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-56 bg-[#003781] text-white lg:fixed lg:h-full z-20">
        <div className="p-5">
          <h1 className="text-lg font-bold uppercase tracking-wider">ManciniGroup</h1>
          <p className="text-blue-300 text-[10px] mt-1">SISTEMA RENDICONTAZIONE</p>
        </div>

        <nav className="px-3 space-y-1 pb-5">
          <NavItem 
            active={selectedTab === 'overview'} 
            onClick={() => setSelectedTab('overview')}
            icon={<LayoutDashboard size={18} />}
            label="Dashboard"
          />
          <NavItem 
            active={selectedTab === 'dettaglio_fl'} 
            onClick={() => setSelectedTab('dettaglio_fl')}
            icon={<Users size={18} />}
            label="Dettaglio FL"
          />
          <NavItem 
            active={selectedTab === 'storico'} 
            onClick={() => setSelectedTab('storico')}
            icon={<History size={18} />}
            label="Storico"
          />
          <NavItem
            active={selectedTab === 'rendicontazione'}
            onClick={() => setSelectedTab('rendicontazione')}
            icon={<ClipboardList size={18} />}
            label="Rendicontazione"
          />
          <NavItem
            active={selectedTab === 'obiettivi'}
            onClick={() => setSelectedTab('obiettivi')}
            icon={<Target size={18} />}
            label="Obiettivi"
          />
          <NavItem
            active={selectedTab === 'avvisi'}
            onClick={() => setSelectedTab('avvisi')}
            icon={<Megaphone size={18} />}
            label="Avvisi"
          />
          <NavItem
            active={selectedTab === 'chiamate'}
            onClick={() => setSelectedTab('chiamate')}
            icon={<PhoneCall size={18} />}
            label="Monitoraggio chiamate"
          />
          <NavItem
            active={selectedTab === 'importazioni'}
            onClick={() => setSelectedTab('importazioni')}
            icon={<FileUp size={18} />}
            label="Importazioni"
          />
          
          <div className="pt-4 mt-4 border-t border-white/10">
            <button 
              onClick={() => auth.signOut()}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-red-300 hover:bg-red-500/10 rounded-lg transition-all text-sm font-medium"
            >
              <LogOut size={18} />
              Esci
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-56 p-3 sm:p-4 lg:p-5">
        {/* Top Header & Global Filters */}
        <header className="mb-5 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-800 leading-tight">
                {selectedTab === 'overview' && 'Panoramica Agenzia'}
                {selectedTab === 'dettaglio_fl' && 'Dettaglio Front Line'}
                {selectedTab === 'storico' && 'Analisi Storica'}
                {selectedTab === 'rendicontazione' && 'Rendicontazione Giornaliera'}
                {selectedTab === 'obiettivi' && 'Obiettivi Front Line'}
                {selectedTab === 'avvisi' && 'Avvisi Front Line'}
                {selectedTab === 'chiamate' && 'Monitoraggio Chiamate'}
                {selectedTab === 'importazioni' && 'Importazioni e Campagne'}
              </h2>
              <p className="text-slate-500 text-xs mt-0.5">{periodLabel}</p>
            </div>

            {/* Date Range Selector */}
            {['overview', 'dettaglio_fl', 'storico'].includes(selectedTab) && (
              <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={exportToCSV}
                  className="flex items-center gap-2 px-3 py-2 bg-white text-slate-600 border border-slate-200 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all"
                >
                  <Download size={16} />
                  Esporta riepilogo
                </button>
                <button
                  onClick={exportHistoryBySourceCSV}
                  disabled={filteredReports.length === 0}
                  className="flex items-center gap-2 px-3 py-2 bg-[#003781] text-white rounded-lg text-xs font-bold hover:bg-[#002a63] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <History size={16} />
                  Storico fonte/giorno
                </button>

              <div className="flex flex-wrap items-center gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
              <FilterButton active={timeRange === 'day'} onClick={() => setTimeRange('day')}>Giorno</FilterButton>
              <FilterButton active={timeRange === 'week'} onClick={() => setTimeRange('week')}>Settimana</FilterButton>
              <FilterButton active={timeRange === 'month'} onClick={() => setTimeRange('month')}>Mese</FilterButton>
              <FilterButton active={timeRange === 'custom'} onClick={() => setTimeRange('custom')}>Custom</FilterButton>
              
              <div className="h-6 w-px bg-slate-200 mx-1" />
              
              <div className="flex items-center gap-2 px-2">
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-xs font-medium text-slate-600 outline-none bg-transparent"
                />
                {timeRange === 'custom' && (
                  <>
                    <span className="text-slate-300">-</span>
                    <input 
                      type="date" 
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-xs font-medium text-slate-600 outline-none bg-transparent"
                    />
                  </>
                )}
              </div>
              </div>
            </div>
            )}
          </div>
        </header>

        {/* Tab Content */}
        <div className="space-y-5">
          {/* OVERVIEW TAB */}
          {selectedTab === 'overview' && (
            <div className="space-y-5">
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={<BarChart3 size={18} />}
                  label="Attività periodo"
                  value={agencyTotal}
                />
                <StatCard
                  icon={<Users size={18} />}
                  label="Dipendenti attivi"
                  value={`${activeEmployeeCount}/${users.length}`}
                />
                <StatCard
                  icon={<Target size={18} />}
                  label="Voci attive"
                  value={`${activeCategoryCount}/${categories.length}`}
                />
                <StatCard
                  icon={<TrendingUp size={18} />}
                  label="Prima fonte"
                  value={employeeTotals[0]?.name || '-'}
                  compact
                />
              </section>

              {/* Global Stats */}
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <SectionHeading
                  icon={<TrendingUp size={18} />}
                  title="Totali Agenzia"
                  meta={`${filteredReports.length} report`}
                />
                <div className="space-y-5 mt-4">
                  {sections.map(section => (
                    <div key={section.id}>
                      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                        {section.title}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2.5">
                        {section.categories.map(category => {
                          const total = categoryTotals.find(item => item.id === category.id)?.total ?? 0;
                          return (
                            <div key={category.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
                              <div className="min-w-0 flex items-center gap-2.5">
                                <div className={cn("shrink-0 p-2 rounded-lg bg-white", category.color)}>
                                  <ReportCategoryGlyph category={category} size={18} />
                                </div>
                                <h3 className="text-xs font-semibold text-slate-700 truncate">{category.label}</h3>
                              </div>
                              <p className={cn("text-xl font-black tabular-nums", total > 0 ? "text-slate-900" : "text-slate-300")}>
                                {total}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Employee Table */}
              <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <SectionHeading
                    icon={<Users size={18} />}
                    title="Performance Dipendenti"
                    meta={`${employeeTotals.length} profili`}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-bold">Dipendente</th>
                        <th className="px-4 py-2.5 text-left font-bold">Totale</th>
                        <th className="px-4 py-2.5 text-left font-bold">Voci principali</th>
                        <th className="px-4 py-2.5 text-right font-bold">Dettaglio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                  {employeeTotals.map((emp) => (
                    <tr key={emp.uid} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[220px]">
                            <div className="w-9 h-9 rounded-lg bg-[#003781] flex items-center justify-center text-white font-black text-sm">
                              {emp.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-slate-800 leading-tight truncate">{emp.name}</h4>
                              <p className="text-xs text-slate-500 truncate">{emp.email}</p>
                            </div>
                          </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-[160px]">
                          <span className="w-12 text-xl font-black text-[#003781] tabular-nums">{emp.grandTotal}</span>
                          <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[#003781]"
                              style={{ width: `${Math.max(4, (emp.grandTotal / Math.max(employeeTotals[0]?.grandTotal || 1, 1)) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5 min-w-[260px]">
                          {categories
                            .map(cat => ({ cat, total: emp.totals[cat.id] || 0 }))
                            .filter(item => item.total > 0)
                            .sort((a, b) => b.total - a.total)
                            .slice(0, 3)
                            .map(({ cat, total }) => (
                              <span key={cat.id} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                                <span className={cat.color}>
                                  <ReportCategoryGlyph category={cat} size={13} />
                                </span>
                                {cat.label}: {total}
                              </span>
                            ))}
                          {emp.grandTotal === 0 && (
                            <span className="text-xs font-semibold text-slate-400">Nessuna attività nel periodo</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button 
                          onClick={() => {
                            setSelectedEmployees([emp.uid]);
                            setSelectedTab('dettaglio_fl');
                          }}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-[#003781] hover:bg-blue-50 transition-all"
                        >
                          Apri
                          <ChevronRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* DETTAGLIO FL TAB */}
          {selectedTab === 'dettaglio_fl' && (
            <div className="space-y-4">
              {/* Employee Selection */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                    <Users size={18} className="text-blue-600" />
                    Seleziona Fonti da Confrontare
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedEmployees(users.map(user => user.uid))}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Seleziona tutto
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEmployees([])}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Pulisci tutto
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {users.map(user => (
                    <button
                      key={user.uid}
                      onClick={() => {
                        setSelectedEmployees(prev => 
                          prev.includes(user.uid) ? prev.filter(id => id !== user.uid) : [...prev, user.uid]
                        );
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                        selectedEmployees.includes(user.uid)
                          ? "bg-[#003781] text-white border-[#003781]"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      {user.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category Selection for Comparison */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm">
                    <Filter size={18} className="text-blue-600" />
                    Seleziona Attività da Confrontare
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedCategoriesFL(categories.map(category => category.id))}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Seleziona tutto
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedCategoriesFL([])}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      Pulisci tutto
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  {sections.map(section => (
                    <div key={section.id}>
                      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                        {section.title}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {section.categories.map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => {
                              setSelectedCategoriesFL(prev =>
                                prev.includes(cat.id)
                                  ? prev.filter(id => id !== cat.id)
                                  : [...prev, cat.id]
                              );
                            }}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                              selectedCategoriesFL.includes(cat.id)
                                ? "bg-[#003781] text-white border-[#003781]"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            <ReportCategoryGlyph category={cat} size={16} />
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Comparison Chart */}
              {selectedEmployees.length > 1 && selectedCategoriesFL.length > 0 && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <h3 className="font-bold text-slate-800 mb-4">Confronto Performance</h3>
                  <div className="h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={employeeComparisonData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip 
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 12px 20px -12px rgb(15 23 42 / 0.35)' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '12px', fontSize: 12 }} />
                        {selectedCategoriesFL.map((catId, i) => (
                          <Bar 
                            key={catId} 
                            dataKey={catId} 
                            name={categories.find(c => c.id === catId)?.label}
                            fill={getChartColor(i)} 
                            radius={[4, 4, 0, 0]} 
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200">
                  <SectionHeading
                    icon={<BarChart3 size={18} />}
                    title="Riepilogo attività per fonte"
                    meta={`${selectedCategoriesFL.length} voci selezionate`}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 text-left font-bold">Fonte</th>
                        <th className="px-4 py-2.5 text-left font-bold">Voce</th>
                        <th className="px-4 py-2.5 text-right font-bold">Numero</th>
                        <th className="px-4 py-2.5 text-right font-bold">Totale fonte</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {employeeActivitySummaryRows.map((row, index) => {
                        const previous = employeeActivitySummaryRows[index - 1];
                        const showEmployee = !previous ||
                          previous.employeeName !== row.employeeName;

                        return (
                          <tr
                            key={`${row.employeeName}-${row.categoryId}`}
                            className="hover:bg-slate-50/70 transition-colors"
                          >
                            <td className="px-4 py-3">
                              {showEmployee ? (
                                <div className="flex items-center gap-3 min-w-[220px]">
                                  <div className="w-8 h-8 rounded-lg bg-[#003781] flex items-center justify-center text-white font-black text-xs">
                                    {row.employeeName.charAt(0)}
                                  </div>
                                  <span className="font-bold text-slate-800">
                                    {row.employeeName}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 min-w-[260px]">
                                {row.category && (
                                  <span className={cn("shrink-0", row.category.color)}>
                                    <ReportCategoryGlyph category={row.category} size={16} />
                                  </span>
                                )}
                                <span className="font-semibold text-slate-700">
                                  {row.category?.label || row.categoryId}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={cn(
                                "font-black tabular-nums",
                                row.value > 0 ? "text-slate-900" : "text-slate-300"
                              )}>
                                {row.value}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {showEmployee ? (
                                <span className="inline-flex justify-end min-w-12 rounded-full bg-[#003781] px-3 py-1 text-xs font-bold text-white tabular-nums">
                                  {row.employeeTotal}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {employeeActivitySummaryRows.length === 0 && (
                  <div className="py-10 text-center text-sm text-slate-500">
                    {selectedEmployees.length === 0
                      ? 'Nessuna fonte selezionata.'
                      : 'Nessuna voce selezionata.'}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* STORICO TAB */}
          {selectedTab === 'storico' && (
            <div className="space-y-4">
              {/* Activity Selection */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm">
                  <TrendingUp size={18} className="text-blue-600" />
                  Seleziona Attività da Analizzare
                </h3>
                <div className="space-y-3">
                  {sections.map(section => (
                    <div key={section.id}>
                      <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                        {section.title}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {section.categories.map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => {
                              setSelectedCategoriesStorico(prev =>
                                prev.includes(cat.id)
                                  ? (prev.length > 1 ? prev.filter(id => id !== cat.id) : prev)
                                  : [...prev, cat.id]
                              );
                            }}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border flex items-center gap-1.5",
                              selectedCategoriesStorico.includes(cat.id)
                                ? "bg-[#003781] text-white border-[#003781]"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            <ReportCategoryGlyph category={cat} size={16} />
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* History Chart */}
              <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-slate-800">Andamento Temporale</h3>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const d = parseISO(startDate);
                        const newD = timeRange === 'month' ? subMonths(d, 1) : subDays(d, timeRange === 'week' ? 7 : 1);
                        setStartDate(formatDate(newD));
                      }}
                      className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <ChevronLeft size={20} />
                    </button>
                    <button 
                      onClick={() => {
                        const d = parseISO(startDate);
                        const newD = timeRange === 'month' ? subMonths(d, -1) : subDays(d, timeRange === 'week' ? -7 : -1);
                        setStartDate(formatDate(newD));
                      }}
                      className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                      <ChevronRightIcon size={20} />
                    </button>
                  </div>
                </div>
                
                <div className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyComparisonData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: '0 12px 20px -12px rgb(15 23 42 / 0.35)' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '12px', fontSize: 12 }} />
                      {selectedCategoriesStorico.map((catId, i) => (
                        <Line 
                          key={catId} 
                          type="monotone" 
                          dataKey={catId} 
                          name={categories.find(c => c.id === catId)?.label}
                          stroke={getChartColor(i)} 
                          strokeWidth={3}
                          dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                          activeDot={{ r: 6, strokeWidth: 0 }}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {selectedTab === 'chiamate' && <AdminCallCenter />}

          {selectedTab === 'importazioni' && <AdminImportPanel />}

          {selectedTab === 'rendicontazione' && <AdminReportCategories categories={categories} />}

          {selectedTab === 'obiettivi' && <AdminDailyObjectives />}

          {selectedTab === 'avvisi' && <AdminNotices />}
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-4 py-3 flex items-center gap-3 min-w-0">
      <div className="shrink-0 w-9 h-9 rounded-lg bg-blue-50 text-[#003781] flex items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={cn("font-black text-slate-900 truncate", compact ? "text-base" : "text-2xl tabular-nums")}>
          {value}
        </p>
      </div>
    </div>
  );
}

function SectionHeading({
  icon,
  title,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <span className="text-blue-600">{icon}</span>
        {title}
      </h3>
      {meta && (
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
          {meta}
        </span>
      )}
    </div>
  );
}

function ReportCategoryGlyph({
  category,
  size,
}: {
  category: ReportCategory;
  size: number;
}) {
  const Icon = getReportCategoryIcon(category.iconKey);
  return <Icon size={size} />;
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-all text-sm font-semibold",
        active 
          ? "bg-white/10 text-white shadow-inner" 
          : "text-blue-200 hover:bg-white/5 hover:text-white"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
        active 
          ? "bg-[#003781] text-white shadow-sm" 
          : "text-slate-500 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function getChartColor(index: number) {
  const colors = [
    '#003781', // Allianz Blue
    '#3b82f6', // Blue 500
    '#8b5cf6', // Violet 500
    '#ec4899', // Pink 500
    '#f59e0b', // Amber 500
    '#10b981', // Emerald 500
    '#6366f1', // Indigo 500
    '#f43f5e', // Rose 500
  ];
  return colors[index % colors.length];
}

function Loader2({ className }: { className?: string }) {
  return <BarChart3 className={cn("animate-pulse", className)} />;
}

function getAdminErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : '';

  if (code.includes('permission-denied')) {
    return 'Firebase ha rifiutato l\'accesso amministratore. Controlla il ruolo utente e pubblica le regole Firestore aggiornate.';
  }

  return 'Non e stato possibile caricare i dati della dashboard. Controlla la connessione e riprova.';
}
