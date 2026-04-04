export type OrderItem = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type Order = {
  id: string;
  customerName: string;
  phone: string;
  address: string;
  items: OrderItem[];
  totalAmount: number;
  paymentMethod: "cod" | "online";
  status: "pending" | "confirmed" | "delivered";
  timestamp: string;
};
