import { useState, ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession, signOut } from 'next-auth/react';
import SidebarItem from './Sidebar'; // Ensure this import path is correct

// Define types for better TypeScript support
export interface Subpage {
  name: string;
  href: string;
}

export interface NavigationItem {
  name: string;
  href?: string;
  icon: string;
  subpages?: Subpage[];
}

interface LayoutProps {
  children: ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const router = useRouter();
  const { data: session } = useSession();

  // --- STATE LIFTING LOGIC ---
  // 1. State now lives in the parent Layout component to persist across navigations.
  const [openMenus, setOpenMenus] = useState<string[]>([]);

  // 2. This function is passed down to each SidebarItem to handle its toggle action.
  const toggleMenu = (itemName: string) => {
    setOpenMenus(prevOpenMenus => {
      if (prevOpenMenus.includes(itemName)) {
        return prevOpenMenus.filter(name => name !== itemName); // Close menu
      } else {
        return [...prevOpenMenus, itemName]; // Open menu
      }
    });
  };

  const navigation: NavigationItem[] = [
    {
      name: 'DASHBOARD',
      href: '/',
      icon: '📊',
    },
    {
      name: 'PRODUCTS',
      href: '/products',
      icon: '📦',
    },
    {
      name: 'PURCHASE',
      href: '/purchases',
      icon: '🛒',
    },
    {
      name: 'INVOICE',
      href: '/sale',
      icon: '📄',
    },
    {
      name: 'INVOICE C',
      href: '/salex',
      icon: '📄',
    },
    {
      name: 'ENTRY',
      icon: '📝',
      subpages: [
        { name: 'SALE RETURN', href: '/entry/salereturn' },
        { name: 'PURCHASE RETURN', href: '/entry/purchasereturn-vendor' },
        { name: 'VENDOR TRANSACTION', href: '/entry/vendor-transaction' },
        { name: 'CUSTOMER TRANSACTION', href: '/entry/customer-transaction' },
        { name: 'DEAD STOCK', href: '/entry/deadstock' },
        { name: 'CUSTOMER DETAILS', href: '/entry/customerdetails' },
        { name: 'VENDOR DETAILS', href: '/entry/vendordetails' },
      ],
    },
    {
      name: 'SETTINGS',
      icon: '⚙️',
      subpages: [
        { name: 'PRODUCT CATEGORY', href: '/products/category' },
        { name: 'PRODUCT SUB CATEGORY', href: '/products/subcategory' },
        { name: 'CAR MODELS', href: '/products/models' },
        { name: 'PART COMPANY', href: '/products/company' },
        { name: 'MECHANIC DETAILS', href: '/settings/mechanics' },
        { name: 'FINANCIAL YEAR', href: '/settings/financialyear' },
        { name: 'USERS', href: '/settings/users' },
        { name: 'STAFF DETAILS', href: '/settings/staffdetails' },
        { name: 'WAREHOUSE', href: '/settings/warehouse' },
        { name: 'WAREHOUSE RACKS', href: '/settings/warehouse-racks' },
        { name: 'BUSINESS DETAILS', href: '/settings/businessdetails' },
        { name: 'BANK DETAILS', href: '/settings/bankdetails' },
        { name: 'GST TAX RATE', href: '/settings/gsttaxrate' },
        { name: 'STATES', href: '/settings/states' },

      ],
    },
    {
      name: 'REPORTS',
      icon: '📊',
      subpages: [
        { name: 'VENDOR LEDGER', href: '/reports/vendor-ledger' },
        { name: 'MINIMUM STOCK', href: '/reports/minimumstock' },
        { name: 'SALE', href: '/reports/sale' },
        { name: 'SALE X', href: '/reports/salex' },
        { name: 'PURCHASE', href: '/reports/purchase' },
        // { name: 'SALE RETURN', href: '/entry/salereturn' },
        { name: 'INACTIVE PRODUCTS', href: '/settings/inactive-products' },
        // { name: 'PURCHASE RETURN', href: '/entry/purchasereturn' }, // Hidden - using purchases/index.tsx instead
        { name: 'DEBIT NOTES', href: '/reports/debit-notes' },
        { name: 'DEAD STOCK', href: '/entry/deadstock' },
        { name: 'OPENING / CLOSING STOCK', href: '/reports/openingclosing' },
        { name: 'MECHANIC SALE', href: '/reports/mechanic' },
        { name: 'COMMISSIONS', href: '/reports/commissions' },
        { name: 'TRANSPORT COST', href: '/reports/transport' },
        { name: 'PACKING / FORWARDING', href: '/reports/packing' },
        { name: 'STAFF SALE', href: '/reports/staff' },
        { name: 'BILL REFERENCE SALE', href: '/reports/billreferencesale' },
        { name: 'BILL REFERENCE PURCHASE', href: '/reports/billreferencepurchase' },
        { name: 'NOTES MENTIONED', href: '/reports/notes' },
      ],
    },
  ];

  // 3. Effect to automatically open the menu of the current page on load/navigation.
  useEffect(() => {
    // Find the parent item whose subpages match the current URL
    const activeParent = navigation.find(item =>
      item.subpages?.some(sub => router.pathname.startsWith(sub.href))
    );

    if (activeParent) {
      // If a parent is found, the state is SET to that parent.
      // This ensures that navigating between sub-pages of the same parent
      // doesn't close the menu.
      setOpenMenus([activeParent.name]);
    } else {
      // If we navigate to a page with no parent (like /purchase),
      // close all menus.
      setOpenMenus([]);
    }
  }, [router.pathname]); // This logic runs on every single page navigation.

  // Removed auto-close sidebar effect as it was causing navigation conflicts
  // The sidebar now stays open/closed based on user preference


  const isActive = (href?: string, subpages?: Subpage[]) => {
    if (subpages?.some(sub => router.pathname == sub.href)) {
      return true;
    }
    return href ? router.pathname == href : false;
  };

  const getPageTitle = () => {
    // Check for custom title from URL query parameter
    if (router.query.title && typeof router.query.title === 'string') {
      return decodeURIComponent(router.query.title);
    }

    // Check for edit mode (when create routes have edit query param)
    const hasEditParam = router.query.edit || router.query.id;

    // Handle dynamic routes first
    if (router.pathname === '/products/create') {
      return hasEditParam ? 'PRODUCT UPDATE' : 'PRODUCT CREATE';
    }
    if (router.pathname.startsWith('/products/view/')) {
      return 'PRODUCT VIEW';
    }
    if (router.pathname.startsWith('/products/')) {
      return 'PRODUCTS';
    }

    // Purchase routes
    if (router.pathname === '/purchases/create') {
      return hasEditParam ? 'PURCHASE UPDATE' : 'PURCHASE CREATE';
    }
    if (router.pathname.startsWith('/purchases/view/')) {
      return 'PURCHASE VIEW';
    }
    if (router.pathname.startsWith('/purchases/')) {
      return 'PURCHASE';
    }
    if(router.pathname.startsWith('/entry/purchasereturn-vendor-create')){
      return 'PURCHASE RETURN'
    }

    // Purchase Returns routes
    if (router.pathname.startsWith('/purchase-returns/')) {
      return 'PURCHASE RETURNS';
    }

    // Sale routes
    if (router.pathname === '/sale/create') {
      return hasEditParam ? 'SALE UPDATE' : 'SALE CREATE';
    }
    if (router.pathname.startsWith('/sale/view/')) {
      return 'SALE VIEW';
    }
    if (router.pathname.startsWith('/sale/')) {
      return 'INVOICE';
    }

    // Salex routes
    if (router.pathname === '/salex/create') {
      return hasEditParam ? 'SALEX UPDATE' : 'SALEX CREATE';
    }
    if (router.pathname.startsWith('/salex/view/')) {
      return 'SALEX VIEW';
    }
    if (router.pathname.startsWith('/salex/')) {
      return 'INVOICE C';
    }

    // Customer routes
    if (router.pathname === '/customers/create') {
      return hasEditParam ? 'CUSTOMER UPDATE' : 'CUSTOMER CREATE';
    }
    if (router.pathname.startsWith('/customers/view/')) {
      return 'CUSTOMER VIEW';
    }

    // Vendor routes
    if (router.pathname === '/vendors/create') {
      return hasEditParam ? 'VENDOR UPDATE' : 'VENDOR CREATE';
    }
    if (router.pathname.startsWith('/vendors/view/')) {
      return 'VENDOR VIEW';
    }

    // Check navigation items
    for (const item of navigation) {
      if (item.subpages) {
        const subpage = item.subpages.find(sub => sub.href === router.pathname);
        if (subpage) return subpage.name;
      }
      if (item.href === router.pathname) {
        return item.name;
      }
    }
    return 'Dashboard'; // Default title
  };

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Sidebar */}
      <div className={`bg-slate-800 border-r border-slate-700 transition-all duration-300 ${sidebarOpen ? 'w-56' : 'w-16'}`}>
        <div className="p-4">
          <div className="space-y-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-700 transition-colors duration-200 w-full flex justify-center"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex flex-col items-center space-y-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">BS</span>
              </div>
              {sidebarOpen && (
                <div className="text-center">
                  <h1 className="text-white font-semibold text-sm">Baijnath Sons</h1>
                  <p className="text-slate-400 text-xs">Inventory Mgmt</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <nav className="mt-8">
          {navigation.map((item) => (
            <SidebarItem
              key={item.name}
              item={item}
              sidebarOpen={sidebarOpen}
              isActive={isActive}
              // Pass the new state and toggle function as props
              isOpen={openMenus.includes(item.name)}
              toggleMenu={() => toggleMenu(item.name)}
              onMenuClick={() => !sidebarOpen && setSidebarOpen(true)}
            />
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-xl font-semibold text-white">
                {getPageTitle()}
              </h2>
            </div>

            <div className="flex items-center space-x-4">
              {/* User Menu */}
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center space-x-2 text-slate-300 hover:text-white p-2 rounded-lg hover:bg-slate-700 transition-colors duration-200"
                >
                  <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center">
                    <span className="text-sm font-medium">
                      {session?.user?.username?.charAt(0).toUpperCase() || 'U'}
                    </span>
                  </div>
                  {sidebarOpen && (
                    <div className="text-left">
                      <p className="text-sm font-medium">{session?.user?.username || 'User'}</p>
                      <p className="text-xs text-slate-400">Online</p>
                    </div>
                  )}
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* User Dropdown Menu */}
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50">
                    <div className="p-3 border-b border-slate-700">
                      <p className="text-sm font-medium text-white">{session?.user?.username}</p>
                      <p className="text-xs text-slate-400">{session?.user?.email}</p>
                    </div>
                    <div className="p-1">
                      <button
                        onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                        className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700 rounded-md transition-colors duration-200 flex items-center space-x-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-3">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
