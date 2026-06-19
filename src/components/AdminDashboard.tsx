import React, { useEffect, useState, useMemo } from 'react';
import { db, auth } from '../firebase';
import { collection, doc, query, onSnapshot, orderBy, setDoc } from 'firebase/firestore';
import {
  CATEGORY_SECTIONS,
  CATEGORIES,
  DailyReport,
  UserProfile,
  CategoryId,
  getAuthorizedAgent,
  getReportCategoryValue,
} from '../constants';
import { 
  Users, 
  BarChart3, 
  Calendar, 
  ChevronRight, 
  LogOut, 
  TrendingUp,
  Search,
  Filter,
  Download,
  LayoutDashboard,
  History,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  AlertTriangle,
  RefreshCw
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
  Line,
  Cell
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
import { downloadCSV, escapeCSVCell } from '../lib/csv';

type Tab = 'overview' | 'dettaglio_fl' | 'storico' | 'chiamate' | 'importazioni';
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
      // Default select all employees for comparison
      if (selectedEmployees.length === 0) {
        setSelectedEmployees(employees.map(e => e.uid));
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
    return CATEGORIES.map(cat => {
      const total = filteredReports.reduce(
        (sum, report) => sum + getReportCategoryValue(report, cat.id),
        0
      );
      return { ...cat, total };
    });
  }, [filteredReports]);

  // Employee Comparison Data
  const employeeComparisonData = useMemo(() => {
    return selectedEmployees.map(uid => {
      const user = users.find(u => u.uid === uid);
      const userReports = filteredReports.filter(r => r.userId === uid);
      const data: any = { name: user?.name || 'Sconosciuto' };
      
      CATEGORIES.forEach(cat => {
        data[cat.id] = userReports.reduce(
          (sum, report) => sum + getReportCategoryValue(report, cat.id),
          0
        );
      });
      
      return data;
    });
  }, [filteredReports, selectedEmployees, users]);

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
      
      CATEGORIES.forEach(cat => {
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
  }, [filteredReports, users]);

  const exportToCSV = () => {
    let csvContent = "data:text/csv;charset=utf-8,";
    
    if (selectedTab === 'overview') {
      csvContent += "Categoria,Totale\n";
      categoryTotals.forEach(cat => {
        csvContent += `${cat.label},${cat.total}\n`;
      });
    } else if (selectedTab === 'dettaglio_fl') {
      const headers = ["Dipendente", ...selectedCategoriesFL.map(id => CATEGORIES.find(c => c.id === id)?.label)];
      csvContent += headers.join(",") + "\n";
      employeeComparisonData.forEach(emp => {
        const row = [emp.name, ...selectedCategoriesFL.map(id => emp[id] || 0)];
        csvContent += row.join(",") + "\n";
      });
    } else {
      const headers = ["Data", ...selectedCategoriesStorico.map(id => CATEGORIES.find(c => c.id === id)?.label)];
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
      ...CATEGORY_SECTIONS.flatMap(section =>
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
        const categoryValues = CATEGORIES.map(category =>
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

  if (loading) {
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
      <aside className="w-full lg:w-64 bg-[#003781] text-white lg:fixed lg:h-full z-20">
        <div className="p-6">
          <h1 className="text-xl font-bold uppercase tracking-wider">ManciniGroup</h1>
          <p className="text-blue-300 text-[10px] mt-1">SISTEMA RENDICONTAZIONE</p>
        </div>

        <nav className="px-4 space-y-1 pb-6">
          <NavItem 
            active={selectedTab === 'overview'} 
            onClick={() => setSelectedTab('overview')}
            icon={<LayoutDashboard size={20} />}
            label="Dashboard"
          />
          <NavItem 
            active={selectedTab === 'dettaglio_fl'} 
            onClick={() => setSelectedTab('dettaglio_fl')}
            icon={<Users size={20} />}
            label="Dettaglio FL"
          />
          <NavItem 
            active={selectedTab === 'storico'} 
            onClick={() => setSelectedTab('storico')}
            icon={<History size={20} />}
            label="Storico"
          />
          <NavItem
            active={selectedTab === 'chiamate'}
            onClick={() => setSelectedTab('chiamate')}
            icon={<PhoneCall size={20} />}
            label="Monitoraggio chiamate"
          />
          <NavItem
            active={selectedTab === 'importazioni'}
            onClick={() => setSelectedTab('importazioni')}
            icon={<FileUp size={20} />}
            label="Importazioni"
          />
          
          <div className="pt-4 mt-4 border-t border-white/10">
            <button 
              onClick={() => auth.signOut()}
              className="w-full flex items-center gap-3 px-4 py-3 text-red-300 hover:bg-red-500/10 rounded-xl transition-all text-sm font-medium"
            >
              <LogOut size={20} />
              Esci
            </button>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 p-4 lg:p-8">
        {/* Top Header & Global Filters */}
        <header className="mb-8 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-800">
                {selectedTab === 'overview' && 'Panoramica Agenzia'}
                {selectedTab === 'dettaglio_fl' && 'Dettaglio Front Line'}
                {selectedTab === 'storico' && 'Analisi Storica'}
                {selectedTab === 'chiamate' && 'Monitoraggio Chiamate'}
                {selectedTab === 'importazioni' && 'Importazioni e Campagne'}
              </h2>
              <p className="text-slate-500 text-sm">Gestione e monitoraggio attività ManciniGroup</p>
            </div>

            {/* Date Range Selector */}
            {['overview', 'dettaglio_fl', 'storico'].includes(selectedTab) && (
              <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={exportToCSV}
                  className="flex items-center gap-2 px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm"
                >
                  <Download size={16} />
                  Esporta riepilogo
                </button>
                <button
                  onClick={exportHistoryBySourceCSV}
                  disabled={filteredReports.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-[#003781] text-white rounded-xl text-xs font-bold hover:bg-[#002a63] transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <History size={16} />
                  Storico fonte/giorno
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 rounded-2xl shadow-sm border border-slate-200">
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
        <div className="space-y-8">
          {/* OVERVIEW TAB */}
          {selectedTab === 'overview' && (
            <div className="space-y-8">
              {/* Global Stats */}
              <section>
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <TrendingUp size={20} className="text-blue-600" />
                  Totali Agenzia
                </h3>
                <div className="space-y-8">
                  {CATEGORY_SECTIONS.map(section => (
                    <div key={section.id}>
                      <h4 className="text-sm font-bold text-slate-600 uppercase mb-3">
                        {section.title}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {section.categories.map(category => {
                          const cat = categoryTotals.find(item => item.id === category.id)!;
                          return (
                            <div key={cat.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
                              <div className="flex items-center justify-between mb-3">
                                <div className={cn("p-2.5 rounded-xl bg-slate-50", cat.color)}>
                                  <cat.icon size={24} />
                                </div>
                                {cat.total > 0 && (
                                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full uppercase">Attivo</span>
                                )}
                              </div>
                              <h3 className="text-slate-500 text-xs font-semibold uppercase">{cat.label}</h3>
                              <p className="text-3xl font-black text-slate-800 mt-1">{cat.total}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Employee Cards */}
              <section>
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Users size={20} className="text-blue-600" />
                  Performance Dipendenti
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {employeeTotals.map((emp) => (
                    <div key={emp.uid} className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                      <div className="p-6 bg-slate-50 border-b border-slate-200">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-[#003781] flex items-center justify-center text-white font-black text-xl">
                              {emp.name.charAt(0)}
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800">{emp.name}</h4>
                              <p className="text-xs text-slate-500">{emp.email}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-black text-[#003781]">{emp.grandTotal}</span>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Punti Totali</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-6 grid grid-cols-2 gap-4 flex-1">
                        {CATEGORIES.slice(0, 6).map(cat => (
                          <div key={cat.id} className="flex items-center gap-3">
                            <div className={cn("p-2 rounded-lg bg-slate-50", cat.color)}>
                              <cat.icon size={16} />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{cat.label}</p>
                              <p className="font-bold text-slate-700">{emp.totals[cat.id] || 0}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="p-4 bg-slate-50 border-t border-slate-200">
                        <button 
                          onClick={() => {
                            setSelectedEmployees([emp.uid]);
                            setSelectedTab('dettaglio_fl');
                          }}
                          className="w-full py-2 text-xs font-bold text-[#003781] hover:bg-white rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                          Vedi Dettaglio Completo
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* DETTAGLIO FL TAB */}
          {selectedTab === 'dettaglio_fl' && (
            <div className="space-y-6">
              {/* Employee Selection */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Users size={18} className="text-blue-600" />
                  Seleziona Dipendenti da Confrontare
                </h3>
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
                        "px-4 py-2 rounded-xl text-sm font-medium transition-all border",
                        selectedEmployees.includes(user.uid)
                          ? "bg-[#003781] text-white border-[#003781] shadow-md"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                      )}
                    >
                      {user.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category Selection for Comparison */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Filter size={18} className="text-blue-600" />
                  Seleziona Attività da Confrontare
                </h3>
                <div className="space-y-5">
                  {CATEGORY_SECTIONS.map(section => (
                    <div key={section.id}>
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">
                        {section.title}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {section.categories.map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => {
                              setSelectedCategoriesFL(prev =>
                                prev.includes(cat.id)
                                  ? (prev.length > 1 ? prev.filter(id => id !== cat.id) : prev)
                                  : [...prev, cat.id]
                              );
                            }}
                            className={cn(
                              "px-4 py-2 rounded-xl text-sm font-medium transition-all border flex items-center gap-2",
                              selectedCategoriesFL.includes(cat.id)
                                ? "bg-[#003781] text-white border-[#003781] shadow-md"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            <cat.icon size={16} />
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Comparison Chart */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="font-bold text-slate-800 mb-6">Confronto Performance</h3>
                  <div className="h-[450px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={employeeComparisonData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                        <Tooltip 
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        {selectedCategoriesFL.map((catId, i) => (
                          <Bar 
                            key={catId} 
                            dataKey={catId} 
                            name={CATEGORIES.find(c => c.id === catId)?.label} 
                            fill={getChartColor(i)} 
                            radius={[4, 4, 0, 0]} 
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="font-bold text-slate-800 mb-6">Classifica Totale</h3>
                  <div className="space-y-4">
                    {[...employeeComparisonData]
                      .sort((a, b) => {
                        const sumA = CATEGORIES.reduce((s, c) => s + (a[c.id] || 0), 0);
                        const sumB = CATEGORIES.reduce((s, c) => s + (b[c.id] || 0), 0);
                        return sumB - sumA;
                      })
                      .map((emp, i) => {
                        const total = CATEGORIES.reduce((s, c) => s + (emp[c.id] || 0), 0);
                        return (
                          <div key={emp.name} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <div className="flex items-center gap-3">
                              <span className="text-lg font-black text-slate-300">#{i+1}</span>
                              <span className="font-bold text-slate-700">{emp.name}</span>
                            </div>
                            <span className="bg-[#003781] text-white px-3 py-1 rounded-full text-xs font-bold">{total} pt</span>
                          </div>
                        );
                      })
                    }
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STORICO TAB */}
          {selectedTab === 'storico' && (
            <div className="space-y-6">
              {/* Activity Selection */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <TrendingUp size={18} className="text-blue-600" />
                  Seleziona Attività da Analizzare
                </h3>
                <div className="space-y-5">
                  {CATEGORY_SECTIONS.map(section => (
                    <div key={section.id}>
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">
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
                              "px-4 py-2 rounded-xl text-sm font-medium transition-all border flex items-center gap-2",
                              selectedCategoriesStorico.includes(cat.id)
                                ? "bg-[#003781] text-white border-[#003781] shadow-md"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            )}
                          >
                            <cat.icon size={16} />
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* History Chart */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-8">
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
                
                <div className="h-[500px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyComparisonData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                      {selectedCategoriesStorico.map((catId, i) => (
                        <Line 
                          key={catId} 
                          type="monotone" 
                          dataKey={catId} 
                          name={CATEGORIES.find(c => c.id === catId)?.label} 
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
        </div>
      </main>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium",
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
        "px-4 py-1.5 rounded-xl text-xs font-bold transition-all",
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
