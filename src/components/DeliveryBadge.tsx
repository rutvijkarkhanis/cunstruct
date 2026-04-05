import { Clock, Truck } from "lucide-react";
import { DeliveryInfo } from "@/lib/delivery";

type Props = {
  delivery: DeliveryInfo;
  compact?: boolean;
};

const DeliveryBadge = ({ delivery, compact }: Props) => {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 bg-success/10 rounded-lg px-3 py-2">
        <Clock className="h-4 w-4 text-success shrink-0" />
        <span className="text-sm font-medium text-success">
          Delivery in {delivery.eta}
        </span>
      </div>
      {!compact && (
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span className="flex items-center gap-1">
            <Truck className="h-3 w-3" /> {delivery.vehicle}
          </span>
          {delivery.isFree ? (
            <span className="text-success font-medium">FREE delivery</span>
          ) : (
            <span>
              Delivery: ₹{delivery.fee}{" "}
              <span className="hidden sm:inline">
                · Free above ₹{delivery.freeAbove.toLocaleString("en-IN")}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default DeliveryBadge;
