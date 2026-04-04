import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { useCart } from "@/context/CartContext";

const Header = () => {
  const { totalItems } = useCart();

  return (
    <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b">
      <div className="container flex items-center justify-between h-14">
        <Link to="/" className="text-lg font-bold tracking-tight text-foreground">
          BuildKart
        </Link>
        <Link to="/cart" className="relative p-2 -mr-2">
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
