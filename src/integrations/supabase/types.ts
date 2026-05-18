export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      callback_tasks: {
        Row: {
          created_at: string
          customer_phone: string
          id: string
          notes: string | null
          project_id: string | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          customer_phone: string
          id?: string
          notes?: string | null
          project_id?: string | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          customer_phone?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: []
      }
      forecast_accuracy: {
        Row: {
          actual_qty: number
          forecast_item_id: string
          id: string
          predicted_qty: number
          recorded_at: string
          variance_pct: number
        }
        Insert: {
          actual_qty: number
          forecast_item_id: string
          id?: string
          predicted_qty: number
          recorded_at?: string
          variance_pct: number
        }
        Update: {
          actual_qty?: number
          forecast_item_id?: string
          id?: string
          predicted_qty?: number
          recorded_at?: string
          variance_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "forecast_accuracy_forecast_item_id_fkey"
            columns: ["forecast_item_id"]
            isOneToOne: false
            referencedRelation: "forecast_items"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_items: {
        Row: {
          actual_delivery_date: string | null
          actual_order_date: string | null
          budget_estimated: number | null
          confidence: string
          confirmed_price: number | null
          confirmed_qty: number | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          delivery_date: string | null
          forecast_id: string
          id: string
          initiated_by: string
          notes: string | null
          order_by_date: string | null
          ordered_at: string | null
          product_id: string
          product_name: string | null
          qty_estimated: number
          risk_flag: boolean
          stage_id: string | null
          status: string
          supplier_name: string | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          actual_delivery_date?: string | null
          actual_order_date?: string | null
          budget_estimated?: number | null
          confidence?: string
          confirmed_price?: number | null
          confirmed_qty?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          delivery_date?: string | null
          forecast_id: string
          id?: string
          initiated_by?: string
          notes?: string | null
          order_by_date?: string | null
          ordered_at?: string | null
          product_id: string
          product_name?: string | null
          qty_estimated?: number
          risk_flag?: boolean
          stage_id?: string | null
          status?: string
          supplier_name?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          actual_delivery_date?: string | null
          actual_order_date?: string | null
          budget_estimated?: number | null
          confidence?: string
          confirmed_price?: number | null
          confirmed_qty?: number | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          delivery_date?: string | null
          forecast_id?: string
          id?: string
          initiated_by?: string
          notes?: string | null
          order_by_date?: string | null
          ordered_at?: string | null
          product_id?: string
          product_name?: string | null
          qty_estimated?: number
          risk_flag?: boolean
          stage_id?: string | null
          status?: string
          supplier_name?: string | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_items_forecast_id_fkey"
            columns: ["forecast_id"]
            isOneToOne: false
            referencedRelation: "forecasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_items_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_items_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stage_master"
            referencedColumns: ["id"]
          },
        ]
      }
      forecasts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          generated_at: string
          horizon_days: number
          id: string
          project_id: string
          status: string
          whatsapp_sent_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          generated_at?: string
          horizon_days: number
          id?: string
          project_id: string
          status?: string
          whatsapp_sent_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          generated_at?: string
          horizon_days?: number
          id?: string
          project_id?: string
          status?: string
          whatsapp_sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecasts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      product: {
        Row: {
          brand: string | null
          category: string | null
          created_at: string
          id: string
          image_url: string | null
          lead_time_days: number | null
          name: string
          selling_price: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          brand?: string | null
          category?: string | null
          created_at?: string
          id: string
          image_url?: string | null
          lead_time_days?: number | null
          name: string
          selling_price?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          brand?: string | null
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          lead_time_days?: number | null
          name?: string
          selling_price?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
        }
        Relationships: []
      }
      project_alerts: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          project_id: string
          related_item_id: string | null
          resolved: boolean
          resolved_at: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          project_id: string
          related_item_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          project_id?: string
          related_item_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_alerts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stages: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          project_id: string
          stage_id: string
          started_at: string | null
          velocity: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          project_id: string
          stage_id: string
          started_at?: string | null
          velocity?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          project_id?: string
          stage_id?: string
          started_at?: string | null
          velocity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_stages_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stage_master"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          account_manager_id: string | null
          area_sqft: number | null
          client_name: string | null
          created_at: string
          current_stage_id: string | null
          customer_name: string | null
          customer_phone: string | null
          estimated_completion: string | null
          floors: number | null
          historical_avg_velocity: number | null
          id: string
          location: string | null
          name: string
          onboarded_at: string
          owner_id: string | null
          progress_pct: number
          project_type: string | null
          projected_completion_date: string | null
          scope: string | null
          status: string
          updated_at: string
          velocity_days_per_pct: number | null
        }
        Insert: {
          account_manager_id?: string | null
          area_sqft?: number | null
          client_name?: string | null
          created_at?: string
          current_stage_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          estimated_completion?: string | null
          floors?: number | null
          historical_avg_velocity?: number | null
          id?: string
          location?: string | null
          name: string
          onboarded_at?: string
          owner_id?: string | null
          progress_pct?: number
          project_type?: string | null
          projected_completion_date?: string | null
          scope?: string | null
          status?: string
          updated_at?: string
          velocity_days_per_pct?: number | null
        }
        Update: {
          account_manager_id?: string | null
          area_sqft?: number | null
          client_name?: string | null
          created_at?: string
          current_stage_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          estimated_completion?: string | null
          floors?: number | null
          historical_avg_velocity?: number | null
          id?: string
          location?: string | null
          name?: string
          onboarded_at?: string
          owner_id?: string | null
          progress_pct?: number
          project_type?: string | null
          projected_completion_date?: string | null
          scope?: string | null
          status?: string
          updated_at?: string
          velocity_days_per_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_account_manager_id_fkey"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_current_stage_id_fkey"
            columns: ["current_stage_id"]
            isOneToOne: false
            referencedRelation: "stage_master"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          created_at: string
          customer_phone: string | null
          forecast_id: string | null
          id: string
          project_id: string | null
          source: string
          status: string
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_phone?: string | null
          forecast_id?: string | null
          id?: string
          project_id?: string | null
          source?: string
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_phone?: string | null
          forecast_id?: string | null
          id?: string
          project_id?: string | null
          source?: string
          status?: string
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      stage_master: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          sequence: number
          typical_duration_days: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sequence: number
          typical_duration_days?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sequence?: number
          typical_duration_days?: number | null
        }
        Relationships: []
      }
      stage_material_mapping: {
        Row: {
          alternate_product_ids: string[] | null
          buffer_days: number
          buffer_pct: number | null
          created_at: string
          id: string
          lead_time_days: number | null
          notes: string | null
          preferred_brands: string[] | null
          priority: string
          product_id: string
          product_name: string | null
          qty_formula: Json | null
          reliability_score: number | null
          stage_id: string
          stock_reliability_score: number
          trigger_offset_days: number | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          alternate_product_ids?: string[] | null
          buffer_days?: number
          buffer_pct?: number | null
          created_at?: string
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          preferred_brands?: string[] | null
          priority?: string
          product_id: string
          product_name?: string | null
          qty_formula?: Json | null
          reliability_score?: number | null
          stage_id: string
          stock_reliability_score?: number
          trigger_offset_days?: number | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          alternate_product_ids?: string[] | null
          buffer_days?: number
          buffer_pct?: number | null
          created_at?: string
          id?: string
          lead_time_days?: number | null
          notes?: string | null
          preferred_brands?: string[] | null
          priority?: string
          product_id?: string
          product_name?: string | null
          qty_formula?: Json | null
          reliability_score?: number | null
          stage_id?: string
          stock_reliability_score?: number
          trigger_offset_days?: number | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_material_mapping_product_fk"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_material_mapping_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stage_master"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_updates: {
        Row: {
          created_by: string | null
          id: string
          note: string | null
          progress_pct: number
          project_id: string
          recorded_at: string
          source: string
          stage_id: string
        }
        Insert: {
          created_by?: string | null
          id?: string
          note?: string | null
          progress_pct: number
          project_id: string
          recorded_at?: string
          source?: string
          stage_id: string
        }
        Update: {
          created_by?: string | null
          id?: string
          note?: string | null
          progress_pct?: number
          project_id?: string
          recorded_at?: string
          source?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stage_updates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_updates_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stage_master"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_reservations: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          expected_delivery_date: string | null
          forecast_item_id: string
          id: string
          notes: string | null
          reserved_at: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expected_delivery_date?: string | null
          forecast_item_id: string
          id?: string
          notes?: string | null
          reserved_at?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expected_delivery_date?: string | null
          forecast_item_id?: string
          id?: string
          notes?: string | null
          reserved_at?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_reservations_forecast_item_id_fkey"
            columns: ["forecast_item_id"]
            isOneToOne: false
            referencedRelation: "forecast_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          approved_by: string | null
          content: string
          contractor_reply: string | null
          created_at: string
          direction: string
          from_phone: string | null
          generated_at: string
          id: string
          message_type: string
          project_id: string
          sent_at: string | null
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          approved_by?: string | null
          content: string
          contractor_reply?: string | null
          created_at?: string
          direction?: string
          from_phone?: string | null
          generated_at?: string
          id?: string
          message_type: string
          project_id: string
          sent_at?: string | null
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          approved_by?: string | null
          content?: string
          contractor_reply?: string | null
          created_at?: string
          direction?: string
          from_phone?: string | null
          generated_at?: string
          id?: string
          message_type?: string
          project_id?: string
          sent_at?: string | null
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "contractor" | "site_engineer" | "ops" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["contractor", "site_engineer", "ops", "admin"],
    },
  },
} as const
