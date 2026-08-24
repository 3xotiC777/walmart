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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      alert_decisions: {
        Row: {
          alert_id: string
          client_mutation_id: string
          column_index: number | null
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["decision_kind"]
          evidence_fingerprint: string | null
          field_name: string | null
          id: number
          note: string | null
          resolved_value: string | null
          scrubbed_at: string | null
          supersede_mutation_id: string | null
          superseded_at: string | null
          superseded_by: string | null
          superseded_reason: string | null
          upload_id: string
          workspace_id: string
        }
        Insert: {
          alert_id: string
          client_mutation_id: string
          column_index?: number | null
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["decision_kind"]
          evidence_fingerprint?: string | null
          field_name?: string | null
          id?: number
          note?: string | null
          resolved_value?: string | null
          scrubbed_at?: string | null
          supersede_mutation_id?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          superseded_reason?: string | null
          upload_id: string
          workspace_id: string
        }
        Update: {
          alert_id?: string
          client_mutation_id?: string
          column_index?: number | null
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["decision_kind"]
          evidence_fingerprint?: string | null
          field_name?: string | null
          id?: number
          note?: string | null
          resolved_value?: string | null
          scrubbed_at?: string | null
          supersede_mutation_id?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
          superseded_reason?: string | null
          upload_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_decisions_alert_id_upload_id_workspace_id_fkey"
            columns: ["alert_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "validation_alerts"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
          {
            foreignKeyName: "alert_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "alert_decisions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      assignment_blocks: {
        Row: {
          alert_count: number
          assigned_to: string | null
          block_key: string
          created_at: string
          external_key: string
          id: string
          invoice_count: number
          member_count: number
          priority: number
          published_at: string | null
          status: Database["public"]["Enums"]["block_status"]
          updated_at: string
          upload_id: string
          version: number
          weight: number
          workspace_id: string
        }
        Insert: {
          alert_count?: number
          assigned_to?: string | null
          block_key: string
          created_at?: string
          external_key: string
          id?: string
          invoice_count?: number
          member_count?: number
          priority?: number
          published_at?: string | null
          status?: Database["public"]["Enums"]["block_status"]
          updated_at?: string
          upload_id: string
          version?: number
          weight?: number
          workspace_id: string
        }
        Update: {
          alert_count?: number
          assigned_to?: string | null
          block_key?: string
          created_at?: string
          external_key?: string
          id?: string
          invoice_count?: number
          member_count?: number
          priority?: number
          published_at?: string | null
          status?: Database["public"]["Enums"]["block_status"]
          updated_at?: string
          upload_id?: string
          version?: number
          weight?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_blocks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "assignment_blocks_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_user_id: string | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: number
          occurred_at: string
          payload: Json
          upload_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_user_id?: string | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: number
          occurred_at?: string
          payload?: Json
          upload_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_user_id?: string | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: number
          occurred_at?: string
          payload?: Json
          upload_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "audit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      cell_resolutions: {
        Row: {
          column_index: number
          created_at: string
          created_by: string
          field_name: string
          id: number
          last_decision_id: number | null
          original_value: string | null
          resolved_value: string
          source: Database["public"]["Enums"]["resolution_source"]
          source_row_id: number
          updated_at: string
          updated_by: string
          upload_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          column_index: number
          created_at?: string
          created_by: string
          field_name: string
          id?: number
          last_decision_id?: number | null
          original_value?: string | null
          resolved_value: string
          source: Database["public"]["Enums"]["resolution_source"]
          source_row_id: number
          updated_at?: string
          updated_by: string
          upload_id: string
          version?: number
          workspace_id: string
        }
        Update: {
          column_index?: number
          created_at?: string
          created_by?: string
          field_name?: string
          id?: number
          last_decision_id?: number | null
          original_value?: string | null
          resolved_value?: string
          source?: Database["public"]["Enums"]["resolution_source"]
          source_row_id?: number
          updated_at?: string
          updated_by?: string
          upload_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cell_resolutions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cell_resolutions_last_decision_id_fkey"
            columns: ["last_decision_id"]
            isOneToOne: false
            referencedRelation: "alert_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cell_resolutions_source_row_id_upload_id_workspace_id_fkey"
            columns: ["source_row_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_rows"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
          {
            foreignKeyName: "cell_resolutions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      conflict_groups: {
        Row: {
          affected_field: string | null
          affected_row_count: number
          alert_count: number
          created_at: string
          external_key: string
          group_key: string
          id: string
          normalized_key: string | null
          observed_values: Json
          rule_code: string
          upload_id: string
          workspace_id: string
        }
        Insert: {
          affected_field?: string | null
          affected_row_count?: number
          alert_count?: number
          created_at?: string
          external_key: string
          group_key: string
          id?: string
          normalized_key?: string | null
          observed_values?: Json
          rule_code: string
          upload_id: string
          workspace_id: string
        }
        Update: {
          affected_field?: string | null
          affected_row_count?: number
          alert_count?: number
          created_at?: string
          external_key?: string
          group_key?: string
          id?: string
          normalized_key?: string | null
          observed_values?: Json
          rule_code?: string
          upload_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflict_groups_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      daily_productivity: {
        Row: {
          activity_date: string
          alerts_resolved: number
          cells_changed: number
          confirmed_correct: number
          rows_corrected: number
          tasks_resolved: number
          updated_at: string
          upload_id: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          activity_date: string
          alerts_resolved?: number
          cells_changed?: number
          confirmed_correct?: number
          rows_corrected?: number
          tasks_resolved?: number
          updated_at?: string
          upload_id: string
          user_id: string
          workspace_id: string
        }
        Update: {
          activity_date?: string
          alerts_resolved?: number
          cells_changed?: number
          confirmed_correct?: number
          rows_corrected?: number
          tasks_resolved?: number
          updated_at?: string
          upload_id?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_productivity_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "daily_productivity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      group_members: {
        Row: {
          created_at: string
          group_id: string
          is_alert: boolean
          is_related_context: boolean
          observed_value: string | null
          source_row_id: number
          upload_id: string
          value_frequency: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          is_alert?: boolean
          is_related_context?: boolean
          observed_value?: string | null
          source_row_id: number
          upload_id: string
          value_frequency?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          is_alert?: boolean
          is_related_context?: boolean
          observed_value?: string | null
          source_row_id?: number
          upload_id?: string
          value_frequency?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_upload_id_workspace_id_fkey"
            columns: ["group_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conflict_groups"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
          {
            foreignKeyName: "group_members_source_row_id_upload_id_workspace_id_fkey"
            columns: ["source_row_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_rows"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
        ]
      }
      ingestion_batches: {
        Row: {
          alert_count: number
          batch_key: string
          payload_hash: string
          processed_at: string
          row_count: number
          upload_id: string
          workspace_id: string
        }
        Insert: {
          alert_count?: number
          batch_key: string
          payload_hash: string
          processed_at?: string
          row_count?: number
          upload_id: string
          workspace_id: string
        }
        Update: {
          alert_count?: number
          batch_key?: string
          payload_hash?: string
          processed_at?: string
          row_count?: number
          upload_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_batches_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      invoice_links: {
        Row: {
          created_at: string
          external_url: string | null
          id: number
          id_dn_w: string | null
          metadata: Json
          ref_id_stg: string | null
          source_row_id: number | null
          storage_object_path: string | null
          upload_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          external_url?: string | null
          id?: number
          id_dn_w?: string | null
          metadata?: Json
          ref_id_stg?: string | null
          source_row_id?: number | null
          storage_object_path?: string | null
          upload_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          external_url?: string | null
          id?: number
          id_dn_w?: string | null
          metadata?: Json
          ref_id_stg?: string | null
          source_row_id?: number | null
          storage_object_path?: string | null
          upload_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_links_source_row_id_upload_id_workspace_id_fkey"
            columns: ["source_row_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_rows"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
          {
            foreignKeyName: "invoice_links_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_email: string
          created_at: string
          created_by: string | null
          display_name: string
          failed_login_count: number
          is_active: boolean
          last_login_at: string | null
          locked_until: string | null
          login_window_started_at: string | null
          must_change_pin: boolean
          pin_reset_at: string | null
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          auth_email: string
          created_at?: string
          created_by?: string | null
          display_name: string
          failed_login_count?: number
          is_active?: boolean
          last_login_at?: string | null
          locked_until?: string | null
          login_window_started_at?: string | null
          must_change_pin?: boolean
          pin_reset_at?: string | null
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          auth_email?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          failed_login_count?: number
          is_active?: boolean
          last_login_at?: string | null
          locked_until?: string | null
          login_window_started_at?: string | null
          must_change_pin?: boolean
          pin_reset_at?: string | null
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      review_tasks: {
        Row: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          alert_count?: number
          assignment_block_id: string
          confirmed_correct_count?: number
          corrected_cell_count?: number
          created_at?: string
          external_key: string
          id?: string
          is_related_only?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          source_row_id: number
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          upload_id: string
          version?: number
          workspace_id: string
        }
        Update: {
          alert_count?: number
          assignment_block_id?: string
          confirmed_correct_count?: number
          corrected_cell_count?: number
          created_at?: string
          external_key?: string
          id?: string
          is_related_only?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          source_row_id?: number
          status?: Database["public"]["Enums"]["review_status"]
          updated_at?: string
          upload_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_tasks_assignment_block_id_upload_id_workspace_id_fkey"
            columns: ["assignment_block_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "assignment_blocks"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
          {
            foreignKeyName: "review_tasks_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "review_tasks_source_row_id_upload_id_workspace_id_fkey"
            columns: ["source_row_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "source_rows"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
        ]
      }
      source_rows: {
        Row: {
          barcode: string | null
          created_at: string
          description: string | null
          excel_row: number
          external_key: string
          field_values: Json
          id: number
          id_dn_w: string | null
          row_id: string | null
          source_fingerprint: string | null
          upload_id: string
          workspace_id: string
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          description?: string | null
          excel_row: number
          external_key: string
          field_values?: Json
          id?: number
          id_dn_w?: string | null
          row_id?: string | null
          source_fingerprint?: string | null
          upload_id: string
          workspace_id: string
        }
        Update: {
          barcode?: string | null
          created_at?: string
          description?: string | null
          excel_row?: number
          external_key?: string
          field_values?: Json
          id?: number
          id_dn_w?: string | null
          row_id?: string | null
          source_fingerprint?: string | null
          upload_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_rows_upload_id_workspace_id_fkey"
            columns: ["upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      uploads: {
        Row: {
          alert_count: number
          assignments_published_at: string | null
          completed_at: string | null
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by: string | null
          has_barcode: boolean
          id: string
          ingestion_finalized_at: string | null
          invoice_object_path: string | null
          invoice_sha256: string | null
          invoice_size_bytes: number | null
          manifest_hash: string | null
          orthography_count: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count: number
          processing_error: string | null
          scrubbed_at: string | null
          source_headers: Json
          source_sheet: string
          status: Database["public"]["Enums"]["upload_status"]
          task_count: number
          total_rows: number
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          alert_count?: number
          assignments_published_at?: string | null
          completed_at?: string | null
          confirmed_correct_count?: number
          corrected_cell_count?: number
          created_at?: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by?: string | null
          has_barcode?: boolean
          id?: string
          ingestion_finalized_at?: string | null
          invoice_object_path?: string | null
          invoice_sha256?: string | null
          invoice_size_bytes?: number | null
          manifest_hash?: string | null
          orthography_count?: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count?: number
          processing_error?: string | null
          scrubbed_at?: string | null
          source_headers?: Json
          source_sheet?: string
          status?: Database["public"]["Enums"]["upload_status"]
          task_count?: number
          total_rows?: number
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          alert_count?: number
          assignments_published_at?: string | null
          completed_at?: string | null
          confirmed_correct_count?: number
          corrected_cell_count?: number
          created_at?: string
          created_by?: string
          delete_after?: string
          display_name?: string
          finalized_by?: string | null
          has_barcode?: boolean
          id?: string
          ingestion_finalized_at?: string | null
          invoice_object_path?: string | null
          invoice_sha256?: string | null
          invoice_size_bytes?: number | null
          manifest_hash?: string | null
          orthography_count?: number
          panel_object_path?: string
          panel_sha256?: string
          panel_size_bytes?: number
          pending_task_count?: number
          processing_error?: string | null
          scrubbed_at?: string | null
          source_headers?: Json
          source_sheet?: string
          status?: Database["public"]["Enums"]["upload_status"]
          task_count?: number
          total_rows?: number
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_alerts: {
        Row: {
          affected_field: string | null
          can_auto_apply: boolean
          category: Database["public"]["Enums"]["alert_category"]
          created_at: string
          detail: string
          event_key: string
          evidence_fingerprint: string | null
          expected_or_conflicts: string | null
          group_id: string | null
          id: string
          original_value: string | null
          resolved_at: string | null
          rule_code: string
          severity: number
          source_column_index: number | null
          status: Database["public"]["Enums"]["review_status"]
          suggested_column_index: number | null
          suggested_column_name: string | null
          suggested_value: string | null
          suggestion_alternatives: Json
          suggestion_confidence: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence: Json
          suggestion_method: string | null
          task_id: string
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        Insert: {
          affected_field?: string | null
          can_auto_apply?: boolean
          category?: Database["public"]["Enums"]["alert_category"]
          created_at?: string
          detail: string
          event_key: string
          evidence_fingerprint?: string | null
          expected_or_conflicts?: string | null
          group_id?: string | null
          id?: string
          original_value?: string | null
          resolved_at?: string | null
          rule_code: string
          severity?: number
          source_column_index?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          suggested_column_index?: number | null
          suggested_column_name?: string | null
          suggested_value?: string | null
          suggestion_alternatives?: Json
          suggestion_confidence?: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence?: Json
          suggestion_method?: string | null
          task_id: string
          updated_at?: string
          upload_id: string
          version?: number
          workspace_id: string
        }
        Update: {
          affected_field?: string | null
          can_auto_apply?: boolean
          category?: Database["public"]["Enums"]["alert_category"]
          created_at?: string
          detail?: string
          event_key?: string
          evidence_fingerprint?: string | null
          expected_or_conflicts?: string | null
          group_id?: string | null
          id?: string
          original_value?: string | null
          resolved_at?: string | null
          rule_code?: string
          severity?: number
          source_column_index?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          suggested_column_index?: number | null
          suggested_column_name?: string | null
          suggested_value?: string | null
          suggestion_alternatives?: Json
          suggestion_confidence?: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence?: Json
          suggestion_method?: string | null
          task_id?: string
          updated_at?: string
          upload_id?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "validation_alerts_group_id_upload_id_workspace_id_fkey"
            columns: ["group_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "conflict_groups"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
          {
            foreignKeyName: "validation_alerts_task_id_upload_id_workspace_id_fkey"
            columns: ["task_id", "upload_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "review_tasks"
            referencedColumns: ["id", "upload_id", "workspace_id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          created_by: string
          is_active: boolean
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          is_active?: boolean
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          audit_retention_days: number
          created_at: string
          created_by: string
          id: string
          name: string
          retention_days: number
          slug: string
          updated_at: string
        }
        Insert: {
          audit_retention_days?: number
          created_at?: string
          created_by: string
          id?: string
          name: string
          retention_days?: number
          slug: string
          updated_at?: string
        }
        Update: {
          audit_retention_days?: number
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          retention_days?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_related_row_to_block: {
        Args: {
          p_block_id: string
          p_expected_block_version: number
          p_source_row_id: number
        }
        Returns: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "review_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_related_row_to_block_guarded: {
        Args: {
          p_block_id: string
          p_expected_block_version: number
          p_source_row_id: number
        }
        Returns: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "review_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_bootstrap_leader: {
        Args: { p_display_name: string; p_token: string; p_username: string }
        Returns: string
      }
      claim_expired_uploads: {
        Args: { p_limit?: number }
        Returns: {
          invoice_object_path: string
          panel_object_path: string
          upload_id: string
          workspace_id: string
        }[]
      }
      confirm_related_task: {
        Args: {
          p_client_mutation_id: string
          p_expected_task_version: number
          p_task_id: string
        }
        Returns: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "review_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_related_task_guarded: {
        Args: {
          p_client_mutation_id: string
          p_expected_task_version: number
          p_task_id: string
        }
        Returns: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "review_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_upload: {
        Args: {
          p_display_name: string
          p_has_barcode?: boolean
          p_invoice_object_path?: string
          p_invoice_sha256_hex?: string
          p_invoice_size_bytes?: number
          p_panel_object_path: string
          p_panel_sha256_hex: string
          p_panel_size_bytes: number
          p_source_headers?: Json
          p_upload_id: string
          p_workspace_id: string
        }
        Returns: {
          alert_count: number
          assignments_published_at: string | null
          completed_at: string | null
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by: string | null
          has_barcode: boolean
          id: string
          ingestion_finalized_at: string | null
          invoice_object_path: string | null
          invoice_sha256: string | null
          invoice_size_bytes: number | null
          manifest_hash: string | null
          orthography_count: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count: number
          processing_error: string | null
          scrubbed_at: string | null
          source_headers: Json
          source_sheet: string
          status: Database["public"]["Enums"]["upload_status"]
          task_count: number
          total_rows: number
          updated_at: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_upload: {
        Args: { p_message: string; p_upload_id: string }
        Returns: {
          alert_count: number
          assignments_published_at: string | null
          completed_at: string | null
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by: string | null
          has_barcode: boolean
          id: string
          ingestion_finalized_at: string | null
          invoice_object_path: string | null
          invoice_sha256: string | null
          invoice_size_bytes: number | null
          manifest_hash: string | null
          orthography_count: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count: number
          processing_error: string | null
          scrubbed_at: string | null
          source_headers: Json
          source_sheet: string
          status: Database["public"]["Enums"]["upload_status"]
          task_count: number
          total_rows: number
          updated_at: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_upload_ingestion: {
        Args: {
          p_expected_alert_count: number
          p_expected_batch_count: number
          p_expected_stored_row_count: number
          p_expected_task_count: number
          p_manifest_hash_hex: string
          p_source_total_rows: number
          p_upload_id: string
        }
        Returns: {
          alert_count: number
          assignments_published_at: string | null
          completed_at: string | null
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by: string | null
          has_barcode: boolean
          id: string
          ingestion_finalized_at: string | null
          invoice_object_path: string | null
          invoice_sha256: string | null
          invoice_size_bytes: number | null
          manifest_hash: string | null
          orthography_count: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count: number
          processing_error: string | null
          scrubbed_at: string | null
          source_headers: Json
          source_sheet: string
          status: Database["public"]["Enums"]["upload_status"]
          task_count: number
          total_rows: number
          updated_at: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_upload_retention: {
        Args: { p_upload_id: string }
        Returns: undefined
      }
      get_login_identity: {
        Args: { p_username: string }
        Returns: {
          auth_email: string
          is_active: boolean
          is_locked: boolean
          locked_until: string
          must_change_pin: boolean
          user_id: string
        }[]
      }
      ingest_validation_batch: {
        Args: { p_batch_key: string; p_payload: Json; p_upload_id: string }
        Returns: Json
      }
      issue_bootstrap_token: {
        Args: {
          p_expires_at: string
          p_token_hash_hex: string
          p_workspace_name: string
          p_workspace_slug: string
        }
        Returns: string
      }
      mark_pin_changed: { Args: never; Returns: undefined }
      mark_pin_changed_for_user: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      propose_balanced_assignments: {
        Args: { p_upload_id: string; p_validator_ids?: string[] }
        Returns: {
          assignee_id: string
          block_id: string
          cumulative_weight: number
        }[]
      }
      propose_balanced_assignments_versioned: {
        Args: {
          p_expected_upload_version: number
          p_upload_id: string
          p_validator_ids?: string[]
        }
        Returns: {
          assignee_id: string
          block_id: string
          cumulative_weight: number
        }[]
      }
      publish_assignments: {
        Args: { p_assignments?: Json; p_upload_id: string }
        Returns: {
          alert_count: number
          assignments_published_at: string | null
          completed_at: string | null
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by: string | null
          has_barcode: boolean
          id: string
          ingestion_finalized_at: string | null
          invoice_object_path: string | null
          invoice_sha256: string | null
          invoice_size_bytes: number | null
          manifest_hash: string | null
          orthography_count: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count: number
          processing_error: string | null
          scrubbed_at: string | null
          source_headers: Json
          source_sheet: string
          status: Database["public"]["Enums"]["upload_status"]
          task_count: number
          total_rows: number
          updated_at: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_assignments_versioned: {
        Args: {
          p_assignments?: Json
          p_expected_upload_version: number
          p_upload_id: string
        }
        Returns: {
          alert_count: number
          assignments_published_at: string | null
          completed_at: string | null
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          created_by: string
          delete_after: string
          display_name: string
          finalized_by: string | null
          has_barcode: boolean
          id: string
          ingestion_finalized_at: string | null
          invoice_object_path: string | null
          invoice_sha256: string | null
          invoice_size_bytes: number | null
          manifest_hash: string | null
          orthography_count: number
          panel_object_path: string
          panel_sha256: string
          panel_size_bytes: number
          pending_task_count: number
          processing_error: string | null
          scrubbed_at: string | null
          source_headers: Json
          source_sheet: string
          status: Database["public"]["Enums"]["upload_status"]
          task_count: number
          total_rows: number
          updated_at: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_assignment_blocks: {
        Args: {
          p_action: string
          p_client_mutation_id: string
          p_expected_source_version: number
          p_expected_target_version: number
          p_source_block_id: string
          p_target_block_id: string
        }
        Returns: Json
      }
      reconcile_assignment_blocks_guarded: {
        Args: {
          p_action: string
          p_client_mutation_id: string
          p_expected_source_version: number
          p_expected_target_version: number
          p_source_block_id: string
          p_target_block_id: string
        }
        Returns: Json
      }
      record_login_attempt: {
        Args: { p_succeeded: boolean; p_username: string }
        Returns: {
          accepted: boolean
          failed_login_count: number
          locked_until: string
        }[]
      }
      register_workspace_member: {
        Args: {
          p_auth_email: string
          p_display_name: string
          p_role?: Database["public"]["Enums"]["workspace_role"]
          p_user_id: string
          p_username: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          is_active: boolean
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_alert: {
        Args: {
          p_alert_id: string
          p_client_mutation_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: {
          affected_field: string | null
          can_auto_apply: boolean
          category: Database["public"]["Enums"]["alert_category"]
          created_at: string
          detail: string
          event_key: string
          evidence_fingerprint: string | null
          expected_or_conflicts: string | null
          group_id: string | null
          id: string
          original_value: string | null
          resolved_at: string | null
          rule_code: string
          severity: number
          source_column_index: number | null
          status: Database["public"]["Enums"]["review_status"]
          suggested_column_index: number | null
          suggested_column_name: string | null
          suggested_value: string | null
          suggestion_alternatives: Json
          suggestion_confidence: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence: Json
          suggestion_method: string | null
          task_id: string
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "validation_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_alert_guarded: {
        Args: {
          p_alert_id: string
          p_client_mutation_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: {
          affected_field: string | null
          can_auto_apply: boolean
          category: Database["public"]["Enums"]["alert_category"]
          created_at: string
          detail: string
          event_key: string
          evidence_fingerprint: string | null
          expected_or_conflicts: string | null
          group_id: string | null
          id: string
          original_value: string | null
          resolved_at: string | null
          rule_code: string
          severity: number
          source_column_index: number | null
          status: Database["public"]["Enums"]["review_status"]
          suggested_column_index: number | null
          suggested_column_name: string | null
          suggested_value: string | null
          suggestion_alternatives: Json
          suggestion_confidence: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence: Json
          suggestion_method: string | null
          task_id: string
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "validation_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_related_task: {
        Args: {
          p_client_mutation_id: string
          p_expected_task_version: number
          p_reason: string
          p_task_id: string
        }
        Returns: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "review_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_related_task_guarded: {
        Args: {
          p_client_mutation_id: string
          p_expected_task_version: number
          p_reason: string
          p_task_id: string
        }
        Returns: {
          alert_count: number
          assignment_block_id: string
          confirmed_correct_count: number
          corrected_cell_count: number
          created_at: string
          external_key: string
          id: string
          is_related_only: boolean
          resolved_at: string | null
          resolved_by: string | null
          source_row_id: number
          status: Database["public"]["Enums"]["review_status"]
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "review_tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_member_pin_state: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: undefined
      }
      resolve_alert: {
        Args: {
          p_alert_id: string
          p_client_mutation_id: string
          p_decision: Database["public"]["Enums"]["decision_kind"]
          p_expected_version: number
          p_note?: string
          p_resolved_value: string
        }
        Returns: {
          affected_field: string | null
          can_auto_apply: boolean
          category: Database["public"]["Enums"]["alert_category"]
          created_at: string
          detail: string
          event_key: string
          evidence_fingerprint: string | null
          expected_or_conflicts: string | null
          group_id: string | null
          id: string
          original_value: string | null
          resolved_at: string | null
          rule_code: string
          severity: number
          source_column_index: number | null
          status: Database["public"]["Enums"]["review_status"]
          suggested_column_index: number | null
          suggested_column_name: string | null
          suggested_value: string | null
          suggestion_alternatives: Json
          suggestion_confidence: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence: Json
          suggestion_method: string | null
          task_id: string
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "validation_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_alert_guarded: {
        Args: {
          p_alert_id: string
          p_client_mutation_id: string
          p_decision: Database["public"]["Enums"]["decision_kind"]
          p_expected_version: number
          p_note?: string
          p_resolved_value: string
        }
        Returns: {
          affected_field: string | null
          can_auto_apply: boolean
          category: Database["public"]["Enums"]["alert_category"]
          created_at: string
          detail: string
          event_key: string
          evidence_fingerprint: string | null
          expected_or_conflicts: string | null
          group_id: string | null
          id: string
          original_value: string | null
          resolved_at: string | null
          rule_code: string
          severity: number
          source_column_index: number | null
          status: Database["public"]["Enums"]["review_status"]
          suggested_column_index: number | null
          suggested_column_name: string | null
          suggested_value: string | null
          suggestion_alternatives: Json
          suggestion_confidence: Database["public"]["Enums"]["suggestion_confidence"]
          suggestion_evidence: Json
          suggestion_method: string | null
          task_id: string
          updated_at: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "validation_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_related_cell_resolution: {
        Args: {
          p_client_mutation_id: string
          p_column_index: number
          p_expected_task_version: number
          p_field_name: string
          p_original_value: string
          p_resolved_value: string
          p_task_id: string
        }
        Returns: {
          column_index: number
          created_at: string
          created_by: string
          field_name: string
          id: number
          last_decision_id: number | null
          original_value: string | null
          resolved_value: string
          source: Database["public"]["Enums"]["resolution_source"]
          source_row_id: number
          updated_at: string
          updated_by: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cell_resolutions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_related_cell_resolution_guarded: {
        Args: {
          p_client_mutation_id: string
          p_column_index: number
          p_expected_task_version: number
          p_field_name: string
          p_original_value: string
          p_resolved_value: string
          p_task_id: string
        }
        Returns: {
          column_index: number
          created_at: string
          created_by: string
          field_name: string
          id: number
          last_decision_id: number | null
          original_value: string | null
          resolved_value: string
          source: Database["public"]["Enums"]["resolution_source"]
          source_row_id: number
          updated_at: string
          updated_by: string
          upload_id: string
          version: number
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cell_resolutions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_workspace_member_active: {
        Args: {
          p_is_active: boolean
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          created_by: string
          is_active: boolean
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      alert_category: "validation" | "orthography" | "structural" | "hierarchy"
      block_status: "draft" | "published" | "in_progress" | "completed"
      decision_kind: "apply_suggestion" | "manual_edit" | "confirmed_correct"
      resolution_source: "suggestion" | "manual" | "related_record"
      review_status: "pending" | "in_progress" | "resolved" | "reopened"
      suggestion_confidence: "none" | "low" | "medium" | "high"
      upload_status:
        | "draft"
        | "uploading"
        | "processing"
        | "ready"
        | "assigning"
        | "active"
        | "completed"
        | "failed"
        | "archived"
        | "deleting"
      workspace_role: "leader" | "validator"
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
      alert_category: ["validation", "orthography", "structural", "hierarchy"],
      block_status: ["draft", "published", "in_progress", "completed"],
      decision_kind: ["apply_suggestion", "manual_edit", "confirmed_correct"],
      resolution_source: ["suggestion", "manual", "related_record"],
      review_status: ["pending", "in_progress", "resolved", "reopened"],
      suggestion_confidence: ["none", "low", "medium", "high"],
      upload_status: [
        "draft",
        "uploading",
        "processing",
        "ready",
        "assigning",
        "active",
        "completed",
        "failed",
        "archived",
        "deleting",
      ],
      workspace_role: ["leader", "validator"],
    },
  },
} as const
