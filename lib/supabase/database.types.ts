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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      conversations: {
        Row: {
          agent: string
          created_at: string
          eve_session_id: string | null
          id: string
          last_message_at: string
          model: string | null
          tenant_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          agent: string
          created_at?: string
          eve_session_id?: string | null
          id?: string
          last_message_at?: string
          model?: string | null
          tenant_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          agent?: string
          created_at?: string
          eve_session_id?: string | null
          id?: string
          last_message_at?: string
          model?: string | null
          tenant_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor_user_id: string | null
          channel: string | null
          contact_key: string | null
          created_at: string
          evidence_url: string | null
          id: number
          payload: Json
          run_id: string | null
          summary: string | null
          tenant_id: string
          type: string
        }
        Insert: {
          actor_user_id?: string | null
          channel?: string | null
          contact_key?: string | null
          created_at?: string
          evidence_url?: string | null
          id?: never
          payload?: Json
          run_id?: string | null
          summary?: string | null
          tenant_id: string
          type: string
        }
        Update: {
          actor_user_id?: string | null
          channel?: string | null
          contact_key?: string | null
          created_at?: string
          evidence_url?: string | null
          id?: never
          payload?: Json
          run_id?: string | null
          summary?: string | null
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      google_tokens: {
        Row: {
          refresh_token: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          refresh_token: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          refresh_token?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          agent: string
          conversation_id: string | null
          cost_usd: number | null
          error: string | null
          eve_session_id: string
          eve_turn_id: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: Database["public"]["Enums"]["run_status"]
          tenant_id: string
          trigger: Database["public"]["Enums"]["run_trigger"]
        }
        Insert: {
          agent: string
          conversation_id?: string | null
          cost_usd?: number | null
          error?: string | null
          eve_session_id: string
          eve_turn_id?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          tenant_id: string
          trigger: Database["public"]["Enums"]["run_trigger"]
        }
        Update: {
          agent?: string
          conversation_id?: string | null
          cost_usd?: number | null
          error?: string | null
          eve_session_id?: string
          eve_turn_id?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          tenant_id?: string
          trigger?: Database["public"]["Enums"]["run_trigger"]
        }
        Relationships: [
          {
            foreignKeyName: "runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_agents: {
        Row: {
          agent: string
          config: Json
          created_at: string
          daily_quota: number | null
          enabled: boolean
          model: string | null
          tenant_id: string
        }
        Insert: {
          agent: string
          config?: Json
          created_at?: string
          daily_quota?: number | null
          enabled?: boolean
          model?: string | null
          tenant_id: string
        }
        Update: {
          agent?: string
          config?: Json
          created_at?: string
          daily_quota?: number | null
          enabled?: boolean
          model?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_agents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          active: boolean
          allowed_domains: string[]
          allowed_models: string[]
          brand: Json
          created_at: string
          default_model: string
          display_name: string
          id: string
          self_signup_by_domain: boolean
          slug: string
        }
        Insert: {
          active?: boolean
          allowed_domains?: string[]
          allowed_models?: string[]
          brand?: Json
          created_at?: string
          default_model?: string
          display_name: string
          id?: string
          self_signup_by_domain?: boolean
          slug: string
        }
        Update: {
          active?: boolean
          allowed_domains?: string[]
          allowed_models?: string[]
          brand?: Json
          created_at?: string
          default_model?: string
          display_name?: string
          id?: string
          self_signup_by_domain?: boolean
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_pending_invitations: { Args: never; Returns: number }
      has_tenant_role: {
        Args: {
          roles: Database["public"]["Enums"]["tenant_role"][]
          tenant: string
        }
        Returns: boolean
      }
      is_member_of: { Args: { tenant: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      run_cost_usd: { Args: { p_run: string }; Returns: number }
    }
    Enums: {
      invitation_status: "pending" | "accepted" | "revoked"
      run_status: "running" | "ok" | "failed" | "cancelled"
      run_trigger: "chat" | "schedule" | "mcp" | "webhook"
      tenant_role: "platform_admin" | "tenant_admin" | "tenant_member"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invitation_status: ["pending", "accepted", "revoked"],
      run_status: ["running", "ok", "failed", "cancelled"],
      run_trigger: ["chat", "schedule", "mcp", "webhook"],
      tenant_role: ["platform_admin", "tenant_admin", "tenant_member"],
    },
  },
} as const
