import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/router'; // Keep for isActive logic on sub-items
import { NavigationItem, Subpage } from './Layout'; // Import types from Layout

// Define the component's props
interface SidebarItemProps {
  item: NavigationItem;
  sidebarOpen: boolean;
  isOpen: boolean; // Receives open state from parent
  toggleMenu: () => void; // Receives toggle function from parent
  isActive: (href?: string, subpages?: Subpage[]) => boolean;
  onMenuClick: () => void; // Function to open sidebar when collapsed
}

const SidebarItem = ({ item, sidebarOpen, isOpen, toggleMenu, isActive, onMenuClick }: SidebarItemProps) => {
  const router = useRouter();

  // This component no longer needs its own `useState` or `useEffect`

  if (item.subpages) {
    return (
      <div className="relative group">
        <div
          onClick={() => {
            if (!sidebarOpen) {
              onMenuClick(); // Open sidebar first
            }
            toggleMenu(); // Then toggle menu
          }}
          className={`flex items-center justify-between px-4 py-3 text-sm font-medium cursor-pointer transition-colors duration-200 ${isActive(item.href, item.subpages)
              ? 'bg-blue-600 text-white border-r-2 border-blue-400'
              : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
        >
          <div className="flex items-center">
            <span className="text-lg mr-3">{item.icon}</span>
            {sidebarOpen && <span>{item.name}</span>}
          </div>
          {sidebarOpen && (
            <span className={`transform transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
              <ChevronDown size={16} />
            </span>
          )}
        </div>

        {/* Tooltip for closed sidebar */}
        {!sidebarOpen && (
          <div className="absolute left-full ml-2 top-0 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-3">
              <div className="text-white font-medium text-sm mb-1">{item.name}</div>
              {(
                // Show only active submenu
                item.subpages
                  .filter(subpage => router.pathname === subpage.href)
                  .map((subpage) => (
                    <div key={subpage.name} className="text-xs text-blue-400 font-medium">
                      ● {subpage.name}
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {isOpen && sidebarOpen && (
          <div className=" bg-slate-800/50 py-1">
            {item.subpages.map((subpage) => (
              <Link
                key={subpage.name}
                href={subpage.href}
                className={`flex items-center px-3 py-3 text-sm font-medium transition-colors duration-200 rounded-md mx-2 my-1 ${router.pathname === subpage.href
                    ? 'text-white bg-slate-700' // Active sub-item style
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
              >
                {subpage.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  } else {
    return (
      <div className="relative group">
        <Link
          href={item.href || '#'}
          onClick={() => !sidebarOpen && onMenuClick()}
          className={`flex items-center px-4 py-4 text-sm font-medium transition-colors duration-200 ${isActive(item.href)
              ? 'bg-blue-600 text-white border-r-2 border-blue-400'
              : 'text-slate-300 hover:bg-slate-700 hover:text-white'
            }`}
        >
          <span className="text-lg mr-3">{item.icon}</span>
          {sidebarOpen && <span>{item.name}</span>}
        </Link>

        {/* Tooltip for closed sidebar */}
        {!sidebarOpen && (
          <div className="absolute left-full ml-2 top-0 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-3">
              <Link
                href={item.href || '#'}
                className="block text-white font-medium text-sm hover:text-blue-400 transition-colors cursor-pointer"
              >
                {item.name}
              </Link>
            </div>
          </div>
        )}
      </div>
    );
  }
};

export default SidebarItem;
