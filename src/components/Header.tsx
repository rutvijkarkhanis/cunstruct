import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/context/CartContext";
import SearchBar from "@/components/SearchBar";
import logo from "@/assets/cunstruct-logo.png";

const Header = () => {
  const { totalItems } = useCart();

  return (
    <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b">
      <div className="container flex items-center gap-3 h-14">
        <Link to="/" aria-label="Cunstruct home" className="shrink-0 flex items-center">
          <img src={logo} alt="Cunstruct" className="h-8 w-auto" />
        </Link>
        <SearchBar />
        <Link to="/cart" className="relative p-2 -mr-2 shrink-0">
          <ShoppingCart className="h-5 w-5 text-foreground" />
          {totalItems > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-5 w-5 rounded-full bg-accent text-accent-foreground text-xs font-semibold flex items-center justify-center">
              {totalItems}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
};

export default Header;
