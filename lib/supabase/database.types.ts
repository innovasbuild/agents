export type Json =
	| string
	| number
	| boolean
	| null
	| { [key: string]: Json | undefined }
	| Json[];

export type Database = {
	graphql_public: {
		Tables: {
			[_ in never]: never;
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			graphql: {
				Args: {
					extensions?: Json;
					operationName?: string;
					query?: string;
					variables?: Json;
				};
				Returns: Json;
			};
		};
		Enums: {
			[_ in never]: never;
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
	public: {
		Tables: {
			accounts: {
				Row: {
					domain: string;
					expires_at: string;
					external_ids: NonNullable<Json>;
					ficha: NonNullable<Json>;
					firmographics: NonNullable<Json>;
					id: string;
					name: string;
					researched_at: string;
					tenant_id: string;
				};
				ComputedFields: never;
				Insert: {
					domain: string;
					expires_at: string;
					external_ids?: NonNullable<Json>;
					ficha: NonNullable<Json>;
					firmographics?: NonNullable<Json>;
					id?: string;
					name: string;
					researched_at?: string;
					tenant_id: string;
				};
				Update: {
					domain?: string;
					expires_at?: string;
					external_ids?: NonNullable<Json>;
					ficha?: NonNullable<Json>;
					firmographics?: NonNullable<Json>;
					id?: string;
					name?: string;
					researched_at?: string;
					tenant_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "accounts_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_access_rules: {
				Row: {
					created_at: string;
					created_by: string | null;
					id: string;
					level: Database["public"]["Enums"]["brain_access_level"];
					path: string;
					principal: Database["public"]["Enums"]["brain_access_principal"];
					tenant_id: string;
					updated_at: string;
					user_id: string | null;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					created_by?: string | null;
					id?: string;
					level: Database["public"]["Enums"]["brain_access_level"];
					path: string;
					principal: Database["public"]["Enums"]["brain_access_principal"];
					tenant_id: string;
					updated_at?: string;
					user_id?: string | null;
				};
				Update: {
					created_at?: string;
					created_by?: string | null;
					id?: string;
					level?: Database["public"]["Enums"]["brain_access_level"];
					path?: string;
					principal?: Database["public"]["Enums"]["brain_access_principal"];
					tenant_id?: string;
					updated_at?: string;
					user_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "brain_access_rules_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_folders: {
				Row: {
					created_at: string;
					created_by: string | null;
					description: string;
					id: string;
					path: string;
					tenant_id: string;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					created_by?: string | null;
					description?: string;
					id?: string;
					path: string;
					tenant_id: string;
					updated_at?: string;
				};
				Update: {
					created_at?: string;
					created_by?: string | null;
					description?: string;
					id?: string;
					path?: string;
					tenant_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "brain_folders_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_mcp_usage: {
				Row: {
					reads: number;
					tenant_id: string;
					user_id: string;
					window_start: string;
					writes: number;
				};
				ComputedFields: never;
				Insert: {
					reads?: number;
					tenant_id: string;
					user_id: string;
					window_start: string;
					writes?: number;
				};
				Update: {
					reads?: number;
					tenant_id?: string;
					user_id?: string;
					window_start?: string;
					writes?: number;
				};
				Relationships: [
					{
						foreignKeyName: "brain_mcp_usage_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_pages: {
				Row: {
					body: string;
					category: string;
					created_at: string;
					frontmatter: NonNullable<Json>;
					id: string;
					revision: number;
					search: unknown;
					slug: string;
					source_hash: string | null;
					source_path: string | null;
					source_revision: number | null;
					status: Database["public"]["Enums"]["brain_page_status"];
					tags: string[];
					tenant_id: string;
					title: string;
					updated_at: string;
					updated_by: string | null;
				};
				ComputedFields: never;
				Insert: {
					body: string;
					category: string;
					created_at?: string;
					frontmatter?: NonNullable<Json>;
					id?: string;
					revision?: number;
					search?: never;
					slug: string;
					source_hash?: string | null;
					source_path?: string | null;
					source_revision?: number | null;
					status?: Database["public"]["Enums"]["brain_page_status"];
					tags?: string[];
					tenant_id: string;
					title: string;
					updated_at?: string;
					updated_by?: string | null;
				};
				Update: {
					body?: string;
					category?: string;
					created_at?: string;
					frontmatter?: NonNullable<Json>;
					id?: string;
					revision?: number;
					search?: never;
					slug?: string;
					source_hash?: string | null;
					source_path?: string | null;
					source_revision?: number | null;
					status?: Database["public"]["Enums"]["brain_page_status"];
					tags?: string[];
					tenant_id?: string;
					title?: string;
					updated_at?: string;
					updated_by?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "brain_pages_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_revisions: {
				Row: {
					approved_by_user_id: string | null;
					author_kind: Database["public"]["Enums"]["brain_author_kind"];
					author_user_id: string | null;
					body: string;
					category: string;
					created_at: string;
					frontmatter: NonNullable<Json>;
					id: number;
					page_id: string;
					reason: string;
					revision: number;
					session_id: string | null;
					status: Database["public"]["Enums"]["brain_page_status"];
					tags: string[];
					tenant_id: string;
					title: string;
				};
				ComputedFields: never;
				Insert: {
					approved_by_user_id?: string | null;
					author_kind: Database["public"]["Enums"]["brain_author_kind"];
					author_user_id?: string | null;
					body: string;
					category: string;
					created_at?: string;
					frontmatter?: NonNullable<Json>;
					id?: never;
					page_id: string;
					reason: string;
					revision: number;
					session_id?: string | null;
					status: Database["public"]["Enums"]["brain_page_status"];
					tags?: string[];
					tenant_id: string;
					title: string;
				};
				Update: {
					approved_by_user_id?: string | null;
					author_kind?: Database["public"]["Enums"]["brain_author_kind"];
					author_user_id?: string | null;
					body?: string;
					category?: string;
					created_at?: string;
					frontmatter?: NonNullable<Json>;
					id?: never;
					page_id?: string;
					reason?: string;
					revision?: number;
					session_id?: string | null;
					status?: Database["public"]["Enums"]["brain_page_status"];
					tags?: string[];
					tenant_id?: string;
					title?: string;
				};
				Relationships: [
					{
						foreignKeyName: "brain_revisions_page_id_fkey";
						columns: ["page_id"];
						isOneToOne: false;
						referencedRelation: "brain_pages";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "brain_revisions_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_skill_files: {
				Row: {
					created_at: string;
					id: string;
					page_id: string;
					path: string;
					sha256: string;
					size: number;
					tenant_id: string;
					uploaded_by: string | null;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					id?: string;
					page_id: string;
					path: string;
					sha256: string;
					size: number;
					tenant_id: string;
					uploaded_by?: string | null;
				};
				Update: {
					created_at?: string;
					id?: string;
					page_id?: string;
					path?: string;
					sha256?: string;
					size?: number;
					tenant_id?: string;
					uploaded_by?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "brain_skill_files_page_id_fkey";
						columns: ["page_id"];
						isOneToOne: false;
						referencedRelation: "brain_pages";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "brain_skill_files_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			brain_skill_versions: {
				Row: {
					action: Database["public"]["Enums"]["brain_skill_action"];
					actor_user_id: string | null;
					body: string;
					created_at: string;
					description: string;
					digest: string;
					files_digest: string;
					frontmatter: NonNullable<Json>;
					id: number;
					manifest: NonNullable<Json>;
					name: string;
					note: string;
					page_id: string | null;
					page_revision: number;
					republished_from: number | null;
					slug: string;
					tenant_id: string;
					title: string;
					version: number;
				};
				ComputedFields: never;
				Insert: {
					action: Database["public"]["Enums"]["brain_skill_action"];
					actor_user_id?: string | null;
					body?: string;
					created_at?: string;
					description?: string;
					digest?: string;
					files_digest?: string;
					frontmatter?: NonNullable<Json>;
					id?: never;
					manifest?: NonNullable<Json>;
					name: string;
					note: string;
					page_id?: string | null;
					page_revision: number;
					republished_from?: number | null;
					slug: string;
					tenant_id: string;
					title?: string;
					version: number;
				};
				Update: {
					action?: Database["public"]["Enums"]["brain_skill_action"];
					actor_user_id?: string | null;
					body?: string;
					created_at?: string;
					description?: string;
					digest?: string;
					files_digest?: string;
					frontmatter?: NonNullable<Json>;
					id?: never;
					manifest?: NonNullable<Json>;
					name?: string;
					note?: string;
					page_id?: string | null;
					page_revision?: number;
					republished_from?: number | null;
					slug?: string;
					tenant_id?: string;
					title?: string;
					version?: number;
				};
				Relationships: [
					{
						foreignKeyName: "brain_skill_versions_page_id_fkey";
						columns: ["page_id"];
						isOneToOne: false;
						referencedRelation: "brain_pages";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "brain_skill_versions_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			config_values: {
				Row: {
					active: boolean;
					created_at: string;
					id: string;
					kind: Database["public"]["Enums"]["config_value_kind"];
					label: string;
					meta: NonNullable<Json>;
					tenant_id: string;
					updated_at: string;
					value: string;
				};
				ComputedFields: never;
				Insert: {
					active?: boolean;
					created_at?: string;
					id?: string;
					kind: Database["public"]["Enums"]["config_value_kind"];
					label: string;
					meta?: NonNullable<Json>;
					tenant_id: string;
					updated_at?: string;
					value: string;
				};
				Update: {
					active?: boolean;
					created_at?: string;
					id?: string;
					kind?: Database["public"]["Enums"]["config_value_kind"];
					label?: string;
					meta?: NonNullable<Json>;
					tenant_id?: string;
					updated_at?: string;
					value?: string;
				};
				Relationships: [
					{
						foreignKeyName: "config_values_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			connector_claims: {
				Row: {
					connection_id: string;
					connector_uid: string;
					created_at: string;
					tenant_id: string;
				};
				ComputedFields: never;
				Insert: {
					connection_id: string;
					connector_uid: string;
					created_at?: string;
					tenant_id: string;
				};
				Update: {
					connection_id?: string;
					connector_uid?: string;
					created_at?: string;
					tenant_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "connector_claims_connection_id_fkey";
						columns: ["connection_id"];
						isOneToOne: false;
						referencedRelation: "tenant_connections";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "connector_claims_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			contacts: {
				Row: {
					account_id: string | null;
					company: string | null;
					contact_key: string;
					created_at: string;
					crm_id: string | null;
					crm_synced_at: string | null;
					domain: string | null;
					email: string | null;
					external_ids: NonNullable<Json>;
					first_touch_at: string | null;
					gmail_thread_id: string | null;
					hook: string | null;
					icp: NonNullable<Json>;
					id: string;
					idioma: string | null;
					last_touch_at: string | null;
					linkedin_slug: string | null;
					name: string | null;
					next_step_at: string | null;
					owner_user_id: string | null;
					replied_at: string | null;
					search_focus_id: string | null;
					segment: string | null;
					source: string;
					stage: Database["public"]["Enums"]["outreach_stage"];
					tenant_id: string;
					title: string | null;
					touches: number;
					updated_at: string;
					vector: string | null;
				};
				ComputedFields: never;
				Insert: {
					account_id?: string | null;
					company?: string | null;
					contact_key: string;
					created_at?: string;
					crm_id?: string | null;
					crm_synced_at?: string | null;
					domain?: string | null;
					email?: string | null;
					external_ids?: NonNullable<Json>;
					first_touch_at?: string | null;
					gmail_thread_id?: string | null;
					hook?: string | null;
					icp?: NonNullable<Json>;
					id?: string;
					idioma?: string | null;
					last_touch_at?: string | null;
					linkedin_slug?: string | null;
					name?: string | null;
					next_step_at?: string | null;
					owner_user_id?: string | null;
					replied_at?: string | null;
					search_focus_id?: string | null;
					segment?: string | null;
					source: string;
					stage?: Database["public"]["Enums"]["outreach_stage"];
					tenant_id: string;
					title?: string | null;
					touches?: number;
					updated_at?: string;
					vector?: string | null;
				};
				Update: {
					account_id?: string | null;
					company?: string | null;
					contact_key?: string;
					created_at?: string;
					crm_id?: string | null;
					crm_synced_at?: string | null;
					domain?: string | null;
					email?: string | null;
					external_ids?: NonNullable<Json>;
					first_touch_at?: string | null;
					gmail_thread_id?: string | null;
					hook?: string | null;
					icp?: NonNullable<Json>;
					id?: string;
					idioma?: string | null;
					last_touch_at?: string | null;
					linkedin_slug?: string | null;
					name?: string | null;
					next_step_at?: string | null;
					owner_user_id?: string | null;
					replied_at?: string | null;
					search_focus_id?: string | null;
					segment?: string | null;
					source?: string;
					stage?: Database["public"]["Enums"]["outreach_stage"];
					tenant_id?: string;
					title?: string | null;
					touches?: number;
					updated_at?: string;
					vector?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "contacts_account_id_tenant_id_fkey";
						columns: ["account_id", "tenant_id"];
						isOneToOne: false;
						referencedRelation: "accounts";
						referencedColumns: ["id", "tenant_id"];
					},
					{
						foreignKeyName: "contacts_search_focus_id_fkey";
						columns: ["search_focus_id"];
						isOneToOne: false;
						referencedRelation: "search_focuses";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "contacts_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "contacts_tenant_id_owner_user_id_fkey";
						columns: ["tenant_id", "owner_user_id"];
						isOneToOne: false;
						referencedRelation: "executors";
						referencedColumns: ["tenant_id", "user_id"];
					},
				];
			};
			conversations: {
				Row: {
					agent: string;
					created_at: string;
					eve_session_id: string | null;
					id: string;
					last_message_at: string;
					model: string | null;
					tenant_id: string;
					title: string | null;
					user_id: string;
				};
				ComputedFields: never;
				Insert: {
					agent: string;
					created_at?: string;
					eve_session_id?: string | null;
					id?: string;
					last_message_at?: string;
					model?: string | null;
					tenant_id: string;
					title?: string | null;
					user_id: string;
				};
				Update: {
					agent?: string;
					created_at?: string;
					eve_session_id?: string | null;
					id?: string;
					last_message_at?: string;
					model?: string | null;
					tenant_id?: string;
					title?: string | null;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "conversations_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			events: {
				Row: {
					actor_user_id: string | null;
					channel: string | null;
					contact_key: string | null;
					created_at: string;
					evidence_url: string | null;
					id: number;
					payload: NonNullable<Json>;
					run_id: string | null;
					summary: string | null;
					tenant_id: string;
					type: string;
				};
				ComputedFields: never;
				Insert: {
					actor_user_id?: string | null;
					channel?: string | null;
					contact_key?: string | null;
					created_at?: string;
					evidence_url?: string | null;
					id?: never;
					payload?: NonNullable<Json>;
					run_id?: string | null;
					summary?: string | null;
					tenant_id: string;
					type: string;
				};
				Update: {
					actor_user_id?: string | null;
					channel?: string | null;
					contact_key?: string | null;
					created_at?: string;
					evidence_url?: string | null;
					id?: never;
					payload?: NonNullable<Json>;
					run_id?: string | null;
					summary?: string | null;
					tenant_id?: string;
					type?: string;
				};
				Relationships: [
					{
						foreignKeyName: "events_run_id_fkey";
						columns: ["run_id"];
						isOneToOne: false;
						referencedRelation: "runs";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "events_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			executors: {
				Row: {
					created_at: string;
					crm_owner_id: string | null;
					daily_quota: number;
					display_name: string | null;
					gmail_authorized_at: string | null;
					gmail_read_authorized_at: string | null;
					linkedin_url: string | null;
					slug: string | null;
					tenant_id: string;
					title: string | null;
					user_id: string;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					crm_owner_id?: string | null;
					daily_quota?: number;
					display_name?: string | null;
					gmail_authorized_at?: string | null;
					gmail_read_authorized_at?: string | null;
					linkedin_url?: string | null;
					slug?: string | null;
					tenant_id: string;
					title?: string | null;
					user_id: string;
				};
				Update: {
					created_at?: string;
					crm_owner_id?: string | null;
					daily_quota?: number;
					display_name?: string | null;
					gmail_authorized_at?: string | null;
					gmail_read_authorized_at?: string | null;
					linkedin_url?: string | null;
					slug?: string | null;
					tenant_id?: string;
					title?: string | null;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "executors_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			invitations: {
				Row: {
					accepted_at: string | null;
					accepted_user_id: string | null;
					created_at: string;
					email: string;
					expires_at: string;
					id: string;
					invited_by: string | null;
					role: Database["public"]["Enums"]["tenant_role"];
					status: Database["public"]["Enums"]["invitation_status"];
					tenant_id: string;
				};
				ComputedFields: never;
				Insert: {
					accepted_at?: string | null;
					accepted_user_id?: string | null;
					created_at?: string;
					email: string;
					expires_at?: string;
					id?: string;
					invited_by?: string | null;
					role?: Database["public"]["Enums"]["tenant_role"];
					status?: Database["public"]["Enums"]["invitation_status"];
					tenant_id: string;
				};
				Update: {
					accepted_at?: string | null;
					accepted_user_id?: string | null;
					created_at?: string;
					email?: string;
					expires_at?: string;
					id?: string;
					invited_by?: string | null;
					role?: Database["public"]["Enums"]["tenant_role"];
					status?: Database["public"]["Enums"]["invitation_status"];
					tenant_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "invitations_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			membership_blocks: {
				Row: {
					blocked_by: string | null;
					created_at: string;
					tenant_id: string;
					user_id: string;
				};
				ComputedFields: never;
				Insert: {
					blocked_by?: string | null;
					created_at?: string;
					tenant_id: string;
					user_id: string;
				};
				Update: {
					blocked_by?: string | null;
					created_at?: string;
					tenant_id?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "membership_blocks_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			memberships: {
				Row: {
					created_at: string;
					id: string;
					role: Database["public"]["Enums"]["tenant_role"];
					tenant_id: string;
					user_id: string;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					id?: string;
					role?: Database["public"]["Enums"]["tenant_role"];
					tenant_id: string;
					user_id: string;
				};
				Update: {
					created_at?: string;
					id?: string;
					role?: Database["public"]["Enums"]["tenant_role"];
					tenant_id?: string;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "memberships_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			onboarding_research: {
				Row: {
					error: string | null;
					hint: string | null;
					result: Json | null;
					status: string;
					tenant_id: string;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					error?: string | null;
					hint?: string | null;
					result?: Json | null;
					status: string;
					tenant_id: string;
					updated_at?: string;
				};
				Update: {
					error?: string | null;
					hint?: string | null;
					result?: Json | null;
					status?: string;
					tenant_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: "onboarding_research_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: true;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			queue_items: {
				Row: {
					ancla: Json | null;
					approval_call_id: string | null;
					approved_at: string | null;
					body: string;
					channel: string;
					contact_id: string;
					contact_key: string;
					created_at: string;
					draft_original: NonNullable<Json>;
					error: string | null;
					eve_session_id: string | null;
					executor_user_id: string;
					expires_at: string;
					gate_result: NonNullable<Json>;
					gmail_message_id: string | null;
					gmail_thread_id: string | null;
					hook: string;
					id: string;
					idioma: string;
					kind: Database["public"]["Enums"]["queue_item_kind"];
					reply_to_message_id: string | null;
					sent_at: string | null;
					status: Database["public"]["Enums"]["queue_item_status"];
					subject: string;
					tenant_id: string;
					to_email: string;
					updated_at: string;
					vector: string;
				};
				ComputedFields: never;
				Insert: {
					ancla?: Json | null;
					approval_call_id?: string | null;
					approved_at?: string | null;
					body: string;
					channel?: string;
					contact_id: string;
					contact_key: string;
					created_at?: string;
					draft_original: NonNullable<Json>;
					error?: string | null;
					eve_session_id?: string | null;
					executor_user_id: string;
					expires_at?: string;
					gate_result: NonNullable<Json>;
					gmail_message_id?: string | null;
					gmail_thread_id?: string | null;
					hook: string;
					id?: string;
					idioma: string;
					kind: Database["public"]["Enums"]["queue_item_kind"];
					reply_to_message_id?: string | null;
					sent_at?: string | null;
					status?: Database["public"]["Enums"]["queue_item_status"];
					subject: string;
					tenant_id: string;
					to_email: string;
					updated_at?: string;
					vector: string;
				};
				Update: {
					ancla?: Json | null;
					approval_call_id?: string | null;
					approved_at?: string | null;
					body?: string;
					channel?: string;
					contact_id?: string;
					contact_key?: string;
					created_at?: string;
					draft_original?: NonNullable<Json>;
					error?: string | null;
					eve_session_id?: string | null;
					executor_user_id?: string;
					expires_at?: string;
					gate_result?: NonNullable<Json>;
					gmail_message_id?: string | null;
					gmail_thread_id?: string | null;
					hook?: string;
					id?: string;
					idioma?: string;
					kind?: Database["public"]["Enums"]["queue_item_kind"];
					reply_to_message_id?: string | null;
					sent_at?: string | null;
					status?: Database["public"]["Enums"]["queue_item_status"];
					subject?: string;
					tenant_id?: string;
					to_email?: string;
					updated_at?: string;
					vector?: string;
				};
				Relationships: [
					{
						foreignKeyName: "queue_items_contact_id_tenant_id_fkey";
						columns: ["contact_id", "tenant_id"];
						isOneToOne: false;
						referencedRelation: "contacts";
						referencedColumns: ["id", "tenant_id"];
					},
					{
						foreignKeyName: "queue_items_tenant_id_executor_user_id_fkey";
						columns: ["tenant_id", "executor_user_id"];
						isOneToOne: false;
						referencedRelation: "executors";
						referencedColumns: ["tenant_id", "user_id"];
					},
					{
						foreignKeyName: "queue_items_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			runs: {
				Row: {
					agent: string;
					conversation_id: string | null;
					cost_usd: number | null;
					error: string | null;
					eve_session_id: string;
					eve_turn_id: string | null;
					finished_at: string | null;
					id: string;
					items_claimed: number | null;
					items_failed: number | null;
					items_ok: number | null;
					items_refused: number | null;
					schedule_key: string | null;
					started_at: string;
					status: Database["public"]["Enums"]["run_status"];
					tenant_id: string;
					trigger: Database["public"]["Enums"]["run_trigger"];
					workflow: string | null;
				};
				ComputedFields: never;
				Insert: {
					agent: string;
					conversation_id?: string | null;
					cost_usd?: number | null;
					error?: string | null;
					eve_session_id: string;
					eve_turn_id?: string | null;
					finished_at?: string | null;
					id?: string;
					items_claimed?: number | null;
					items_failed?: number | null;
					items_ok?: number | null;
					items_refused?: number | null;
					schedule_key?: string | null;
					started_at?: string;
					status?: Database["public"]["Enums"]["run_status"];
					tenant_id: string;
					trigger: Database["public"]["Enums"]["run_trigger"];
					workflow?: string | null;
				};
				Update: {
					agent?: string;
					conversation_id?: string | null;
					cost_usd?: number | null;
					error?: string | null;
					eve_session_id?: string;
					eve_turn_id?: string | null;
					finished_at?: string | null;
					id?: string;
					items_claimed?: number | null;
					items_failed?: number | null;
					items_ok?: number | null;
					items_refused?: number | null;
					schedule_key?: string | null;
					started_at?: string;
					status?: Database["public"]["Enums"]["run_status"];
					tenant_id?: string;
					trigger?: Database["public"]["Enums"]["run_trigger"];
					workflow?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "runs_conversation_id_fkey";
						columns: ["conversation_id"];
						isOneToOne: false;
						referencedRelation: "conversations";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "runs_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			search_focuses: {
				Row: {
					accounts_found: number;
					contacts_found: number;
					created_at: string;
					created_by: string;
					criteria: NonNullable<Json>;
					hook: string;
					id: string;
					idioma: string;
					max_accounts: number;
					max_contacts: number;
					name: string;
					segment: string;
					status: Database["public"]["Enums"]["search_focus_status"];
					tenant_id: string;
					updated_at: string;
					vector: string;
				};
				ComputedFields: never;
				Insert: {
					accounts_found?: number;
					contacts_found?: number;
					created_at?: string;
					created_by: string;
					criteria?: NonNullable<Json>;
					hook: string;
					id?: string;
					idioma: string;
					max_accounts: number;
					max_contacts: number;
					name: string;
					segment: string;
					status?: Database["public"]["Enums"]["search_focus_status"];
					tenant_id: string;
					updated_at?: string;
					vector: string;
				};
				Update: {
					accounts_found?: number;
					contacts_found?: number;
					created_at?: string;
					created_by?: string;
					criteria?: NonNullable<Json>;
					hook?: string;
					id?: string;
					idioma?: string;
					max_accounts?: number;
					max_contacts?: number;
					name?: string;
					segment?: string;
					status?: Database["public"]["Enums"]["search_focus_status"];
					tenant_id?: string;
					updated_at?: string;
					vector?: string;
				};
				Relationships: [
					{
						foreignKeyName: "search_focuses_tenant_id_created_by_fkey";
						columns: ["tenant_id", "created_by"];
						isOneToOne: false;
						referencedRelation: "executors";
						referencedColumns: ["tenant_id", "user_id"];
					},
					{
						foreignKeyName: "search_focuses_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			tenant_agents: {
				Row: {
					agent: string;
					config: NonNullable<Json>;
					created_at: string;
					daily_quota: number | null;
					enabled: boolean;
					model: string | null;
					tenant_id: string;
				};
				ComputedFields: never;
				Insert: {
					agent: string;
					config?: NonNullable<Json>;
					created_at?: string;
					daily_quota?: number | null;
					enabled?: boolean;
					model?: string | null;
					tenant_id: string;
				};
				Update: {
					agent?: string;
					config?: NonNullable<Json>;
					created_at?: string;
					daily_quota?: number | null;
					enabled?: boolean;
					model?: string | null;
					tenant_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: "tenant_agents_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			tenant_budgets: {
				Row: {
					daily_limit: number;
					resource: string;
					tenant_id: string;
					updated_at: string;
					updated_by: string | null;
				};
				ComputedFields: never;
				Insert: {
					daily_limit: number;
					resource: string;
					tenant_id: string;
					updated_at?: string;
					updated_by?: string | null;
				};
				Update: {
					daily_limit?: number;
					resource?: string;
					tenant_id?: string;
					updated_at?: string;
					updated_by?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "tenant_budgets_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			tenant_connections: {
				Row: {
					capability: Database["public"]["Enums"]["connector_capability"];
					config: NonNullable<Json>;
					connector_uid: string | null;
					created_at: string;
					enabled: boolean;
					id: string;
					locked_by_platform: boolean;
					provider: string;
					tenant_id: string;
					updated_at: string;
					updated_by: string | null;
					verified_at: string | null;
					verified_name: string | null;
				};
				ComputedFields: never;
				Insert: {
					capability: Database["public"]["Enums"]["connector_capability"];
					config?: NonNullable<Json>;
					connector_uid?: string | null;
					created_at?: string;
					enabled?: boolean;
					id?: string;
					locked_by_platform?: boolean;
					provider: string;
					tenant_id: string;
					updated_at?: string;
					updated_by?: string | null;
					verified_at?: string | null;
					verified_name?: string | null;
				};
				Update: {
					capability?: Database["public"]["Enums"]["connector_capability"];
					config?: NonNullable<Json>;
					connector_uid?: string | null;
					created_at?: string;
					enabled?: boolean;
					id?: string;
					locked_by_platform?: boolean;
					provider?: string;
					tenant_id?: string;
					updated_at?: string;
					updated_by?: string | null;
					verified_at?: string | null;
					verified_name?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "tenant_connections_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			tenant_domains: {
				Row: {
					created_at: string;
					created_by: string | null;
					hostname: string;
					id: string;
					is_primary: boolean;
					last_error: string | null;
					status: string;
					tenant_id: string;
					verified_at: string | null;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					created_by?: string | null;
					hostname: string;
					id?: string;
					is_primary?: boolean;
					last_error?: string | null;
					status?: string;
					tenant_id: string;
					verified_at?: string | null;
				};
				Update: {
					created_at?: string;
					created_by?: string | null;
					hostname?: string;
					id?: string;
					is_primary?: boolean;
					last_error?: string | null;
					status?: string;
					tenant_id?: string;
					verified_at?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "tenant_domains_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			tenant_workflows: {
				Row: {
					config: NonNullable<Json>;
					created_at: string;
					enabled: boolean;
					last_run_at: string | null;
					tenant_id: string;
					workflow: string;
				};
				ComputedFields: never;
				Insert: {
					config?: NonNullable<Json>;
					created_at?: string;
					enabled?: boolean;
					last_run_at?: string | null;
					tenant_id: string;
					workflow: string;
				};
				Update: {
					config?: NonNullable<Json>;
					created_at?: string;
					enabled?: boolean;
					last_run_at?: string | null;
					tenant_id?: string;
					workflow?: string;
				};
				Relationships: [
					{
						foreignKeyName: "tenant_workflows_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			tenants: {
				Row: {
					active: boolean;
					ai_monthly_limit_usd: number | null;
					allowed_domains: string[];
					allowed_models: string[];
					auth_methods: string[];
					brand: NonNullable<Json>;
					created_at: string;
					default_model: string;
					display_name: string;
					id: string;
					onboarding_completed_at: string | null;
					onboarding_step: string | null;
					plan: string;
					self_signup_by_domain: boolean;
					slug: string;
					suspended_reason: string | null;
					trial_ends_at: string | null;
				};
				ComputedFields: never;
				Insert: {
					active?: boolean;
					ai_monthly_limit_usd?: number | null;
					allowed_domains?: string[];
					allowed_models?: string[];
					auth_methods?: string[];
					brand?: NonNullable<Json>;
					created_at?: string;
					default_model?: string;
					display_name: string;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string | null;
					plan?: string;
					self_signup_by_domain?: boolean;
					slug: string;
					suspended_reason?: string | null;
					trial_ends_at?: string | null;
				};
				Update: {
					active?: boolean;
					ai_monthly_limit_usd?: number | null;
					allowed_domains?: string[];
					allowed_models?: string[];
					auth_methods?: string[];
					brand?: NonNullable<Json>;
					created_at?: string;
					default_model?: string;
					display_name?: string;
					id?: string;
					onboarding_completed_at?: string | null;
					onboarding_step?: string | null;
					plan?: string;
					self_signup_by_domain?: boolean;
					slug?: string;
					suspended_reason?: string | null;
					trial_ends_at?: string | null;
				};
				Relationships: [];
			};
			usage_entries: {
				Row: {
					amount: number;
					created_at: string;
					id: number;
					meta: NonNullable<Json>;
					node: string;
					resource: string;
					run_id: string | null;
					tenant_id: string;
					unit: string;
					workflow: string | null;
				};
				ComputedFields: never;
				Insert: {
					amount: number;
					created_at?: string;
					id?: never;
					meta?: NonNullable<Json>;
					node: string;
					resource: string;
					run_id?: string | null;
					tenant_id: string;
					unit: string;
					workflow?: string | null;
				};
				Update: {
					amount?: number;
					created_at?: string;
					id?: never;
					meta?: NonNullable<Json>;
					node?: string;
					resource?: string;
					run_id?: string | null;
					tenant_id?: string;
					unit?: string;
					workflow?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: "usage_entries_run_id_fkey";
						columns: ["run_id"];
						isOneToOne: false;
						referencedRelation: "runs";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "usage_entries_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
			work_items: {
				Row: {
					attempts: number;
					created_at: string;
					id: number;
					input_hash: string;
					last_error: string | null;
					lease_until: string | null;
					next_attempt_at: string;
					result_reason: string | null;
					run_id: string | null;
					status: Database["public"]["Enums"]["work_item_status"];
					subject_id: string;
					subject_type: string;
					tenant_id: string;
					updated_at: string;
					workflow: string;
				};
				ComputedFields: never;
				Insert: {
					attempts?: number;
					created_at?: string;
					id?: never;
					input_hash: string;
					last_error?: string | null;
					lease_until?: string | null;
					next_attempt_at?: string;
					result_reason?: string | null;
					run_id?: string | null;
					status?: Database["public"]["Enums"]["work_item_status"];
					subject_id: string;
					subject_type: string;
					tenant_id: string;
					updated_at?: string;
					workflow: string;
				};
				Update: {
					attempts?: number;
					created_at?: string;
					id?: never;
					input_hash?: string;
					last_error?: string | null;
					lease_until?: string | null;
					next_attempt_at?: string;
					result_reason?: string | null;
					run_id?: string | null;
					status?: Database["public"]["Enums"]["work_item_status"];
					subject_id?: string;
					subject_type?: string;
					tenant_id?: string;
					updated_at?: string;
					workflow?: string;
				};
				Relationships: [
					{
						foreignKeyName: "work_items_run_id_fkey";
						columns: ["run_id"];
						isOneToOne: false;
						referencedRelation: "runs";
						referencedColumns: ["id"];
					},
					{
						foreignKeyName: "work_items_tenant_id_fkey";
						columns: ["tenant_id"];
						isOneToOne: false;
						referencedRelation: "tenants";
						referencedColumns: ["id"];
					},
				];
			};
		};
		Views: {
			[_ in never]: never;
		};
		Functions: {
			accept_pending_invitations: {
				Args: Record<PropertyKey, never>;
				Returns: number;
			};
			block_member: {
				Args: { p_tenant: string; p_user: string };
				Returns: undefined;
			};
			brain_category_for: { Args: { p_path: string }; Returns: string };
			brain_cleanup_orphan_access_rules: {
				Args: Record<PropertyKey, never>;
				Returns: number;
			};
			brain_create_folder: {
				Args: {
					p_actor: string;
					p_description: string;
					p_path: string;
					p_tenant: string;
				};
				Returns: undefined;
			};
			brain_delete_folder: {
				Args: { p_actor: string; p_path: string; p_tenant: string };
				Returns: undefined;
			};
			brain_delete_page: {
				Args: {
					p_actor: string;
					p_binding_id: string;
					p_cleanups: Json;
					p_expected_revision: number;
					p_slug: string;
					p_tenant_id: string;
				};
				Returns: {
					cleaned: number;
					deleted_revisions: number;
					rules_removed: number;
				}[];
			};
			brain_ensure_folders: {
				Args: { p_actor: string; p_path: string; p_tenant: string };
				Returns: number;
			};
			brain_folders_from_config: {
				Args: { p_tenant: string };
				Returns: number;
			};
			brain_mcp_hit: {
				Args: {
					p_kind: string;
					p_limit: number;
					p_tenant_id: string;
					p_user_id: string;
				};
				Returns: {
					allowed: boolean;
					retry_after_seconds: number;
				}[];
			};
			brain_page_links: {
				Args: { p_tenant_id: string };
				Returns: {
					links: Json;
					slug: string;
				}[];
			};
			brain_page_links_after: {
				Args: { p_after: string; p_limit: number; p_tenant_id: string };
				Returns: {
					links: Json;
					slug: string;
				}[];
			};
			brain_publish_skill: {
				Args: {
					p_actor: string;
					p_expected_files_digest: string;
					p_expected_revision: number;
					p_from_version?: number;
					p_note: string;
					p_page_id: string;
					p_tenant_id: string;
				};
				Returns: {
					skill_digest: string;
					skill_version: number;
				}[];
			};
			brain_remove_access_rule: {
				Args: {
					p_actor: string;
					p_path: string;
					p_principal: Database["public"]["Enums"]["brain_access_principal"];
					p_tenant_id: string;
					p_user_id: string;
				};
				Returns: undefined;
			};
			brain_search_pages: {
				Args: {
					p_category?: string;
					p_include_archived?: boolean;
					p_limit?: number;
					p_query: string;
					p_tag?: string;
					p_tenant_id: string;
				};
				Returns: {
					category: string;
					slug: string;
					snippet: string;
					status: Database["public"]["Enums"]["brain_page_status"];
					tags: string[];
					title: string;
					updated_at: string;
				}[];
			};
			brain_set_access_rule: {
				Args: {
					p_actor: string;
					p_level: Database["public"]["Enums"]["brain_access_level"];
					p_path: string;
					p_principal: Database["public"]["Enums"]["brain_access_principal"];
					p_tenant_id: string;
					p_user_id: string;
				};
				Returns: undefined;
			};
			brain_set_folder_description: {
				Args: {
					p_actor: string;
					p_description: string;
					p_path: string;
					p_tenant: string;
				};
				Returns: undefined;
			};
			brain_skill_files_digest: {
				Args: { p_page_id: string };
				Returns: string;
			};
			brain_skill_overview: {
				Args: { p_tenant_id: string };
				Returns: {
					action: Database["public"]["Enums"]["brain_skill_action"];
					body: string;
					description: string;
					digest: string;
					draft_files_digest: string;
					files_digest: string;
					frontmatter: Json;
					manifest: Json;
					page_id: string;
					page_revision: number;
					published_at: string;
					revision: number;
					slug: string;
					title: string;
					version: number;
				}[];
			};
			brain_skill_put_file: {
				Args: {
					p_actor: string;
					p_page_id: string;
					p_path: string;
					p_sha256: string;
					p_size: number;
					p_tenant_id: string;
				};
				Returns: string;
			};
			brain_skill_remove_file: {
				Args: {
					p_actor: string;
					p_page_id: string;
					p_path: string;
					p_tenant_id: string;
				};
				Returns: string;
			};
			brain_sync_categories: { Args: { p_tenant: string }; Returns: undefined };
			brain_upsert_page: {
				Args: {
					p_author_kind: Database["public"]["Enums"]["brain_author_kind"];
					p_author_user_id: string;
					p_base_revision: number;
					p_binding_id: string;
					p_body: string;
					p_category: string;
					p_frontmatter: Json;
					p_reason: string;
					p_session_id: string;
					p_slug: string;
					p_source_hash?: string;
					p_source_path?: string;
					p_status: Database["public"]["Enums"]["brain_page_status"];
					p_tags: string[];
					p_tenant_id: string;
					p_title: string;
				};
				Returns: {
					page_id: string;
					page_revision: number;
					page_slug: string;
				}[];
			};
			brain_withdraw_skill: {
				Args: {
					p_actor: string;
					p_note: string;
					p_page_id: string;
					p_tenant_id: string;
				};
				Returns: boolean;
			};
			claim_work_items: {
				Args: {
					p_lease_seconds: number;
					p_limit: number;
					p_tenant: string;
					p_workflow: string;
				};
				Returns: {
					attempts: number;
					created_at: string;
					id: number;
					input_hash: string;
					last_error: string | null;
					lease_until: string | null;
					next_attempt_at: string;
					result_reason: string | null;
					run_id: string | null;
					status: Database["public"]["Enums"]["work_item_status"];
					subject_id: string;
					subject_type: string;
					tenant_id: string;
					updated_at: string;
					workflow: string;
				}[];
				SetofOptions: {
					from: "*";
					to: "work_items";
					isOneToOne: false;
					isSetofReturn: true;
				};
			};
			current_login_method: {
				Args: Record<PropertyKey, never>;
				Returns: string;
			};
			custom_access_token_hook: { Args: { event: Json }; Returns: Json };
			f_unaccent: { Args: { value: string }; Returns: string };
			has_tenant_role: {
				Args: {
					roles: Database["public"]["Enums"]["tenant_role"][];
					tenant: string;
				};
				Returns: boolean;
			};
			is_member_of: { Args: { tenant: string }; Returns: boolean };
			is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
			is_public_email_domain: { Args: { p_domain: string }; Returns: boolean };
			join_tenants_by_domain: {
				Args: Record<PropertyKey, never>;
				Returns: number;
			};
			login_gate: { Args: Record<PropertyKey, never>; Returns: Json };
			outreach_reflect_marco: {
				Args: { p_hooks: Json; p_tenant: string; p_vectors: Json };
				Returns: Json;
			};
			platform_bind_connection: {
				Args: {
					p_actor: string;
					p_capability: Database["public"]["Enums"]["connector_capability"];
					p_config: Json;
					p_connector_uids: string[];
					p_provider: string;
					p_tenant: string;
					p_verified_name: string;
				};
				Returns: string;
			};
			platform_create_tenant: {
				Args: {
					p_actor: string;
					p_agents: string[];
					p_allowed_domains: string[];
					p_auth_methods: string[];
					p_brand: Json;
					p_display_name: string;
					p_slug: string;
				};
				Returns: string;
			};
			platform_enable_brain_skills: {
				Args: { p_actor: string; p_tenant: string };
				Returns: boolean;
			};
			platform_mark_connection_verified: {
				Args: {
					p_actor: string;
					p_connection: string;
					p_verified_name: string;
				};
				Returns: undefined;
			};
			platform_remove_connection: {
				Args: { p_actor: string; p_connection: string };
				Returns: undefined;
			};
			platform_set_agent: {
				Args: {
					p_actor: string;
					p_agent: string;
					p_brain: string;
					p_enabled: boolean;
					p_tenant: string;
				};
				Returns: undefined;
			};
			platform_set_budget: {
				Args: {
					p_actor: string;
					p_daily_limit: number;
					p_resource: string;
					p_tenant: string;
				};
				Returns: undefined;
			};
			platform_set_connection_enabled: {
				Args: { p_actor: string; p_connection: string; p_enabled: boolean };
				Returns: undefined;
			};
			platform_spend_report: {
				Args: { p_from: string; p_to: string };
				Returns: {
					amount: number;
					tenant_id: string;
				}[];
			};
			refresh_fichas_candidates: {
				Args: { p_limit: number; p_now: string; p_tenant: string };
				Returns: {
					domain: string;
					expires_at: string;
					id: string;
					name: string;
					researched_at: string;
				}[];
			};
			remove_executor: {
				Args: { p_tenant: string; p_user: string };
				Returns: undefined;
			};
			resolve_tenant_by_host: { Args: { p_host: string }; Returns: string };
			run_cost_usd: { Args: { p_run: string }; Returns: number };
			self_serve_create_tenant: {
				Args: { p_display_name: string; p_domain: string };
				Returns: Json;
			};
			set_ai_monthly_limit: {
				Args: { p_limit: number; p_tenant: string };
				Returns: undefined;
			};
			set_approval: {
				Args: {
					p_agent: string;
					p_node: string;
					p_policy: string;
					p_tenant: string;
				};
				Returns: undefined;
			};
			set_connection_enabled: {
				Args: { p_connection: string; p_enabled: boolean; p_tenant: string };
				Returns: undefined;
			};
			set_executor: {
				Args: {
					p_daily_quota: number;
					p_display_name: string;
					p_linkedin_url: string;
					p_slug: string;
					p_tenant: string;
					p_title: string;
					p_user: string;
				};
				Returns: undefined;
			};
			set_list_value: {
				Args: {
					p_active: boolean;
					p_kind: Database["public"]["Enums"]["config_value_kind"];
					p_label: string;
					p_tenant: string;
					p_value: string;
				};
				Returns: undefined;
			};
			set_onboarding_step: {
				Args: { p_step: string; p_tenant: string };
				Returns: undefined;
			};
			set_outreach_config: {
				Args: { p_config: Json; p_tenant: string };
				Returns: undefined;
			};
			set_run_cost: { Args: { p_run: string }; Returns: number };
			set_tenant_auth_methods: {
				Args: { p_methods: string[]; p_tenant: string };
				Returns: undefined;
			};
			set_tenant_profile: {
				Args: { p_brand: Json; p_display_name: string; p_tenant: string };
				Returns: undefined;
			};
			set_workflow: {
				Args: {
					p_cadence_minutes: number;
					p_enabled: boolean;
					p_items_per_tick: number;
					p_tenant: string;
					p_workflow: string;
				};
				Returns: undefined;
			};
			settings_actor: { Args: { p_tenant: string }; Returns: string };
			signup_route: { Args: Record<PropertyKey, never>; Returns: string };
			slug_from_domain: { Args: { p_domain: string }; Returns: string };
			tenant_allows_login: { Args: { p_tenant: string }; Returns: boolean };
			tenant_budget_status: {
				Args: { p_resources: string[]; p_since: string; p_tenant: string };
				Returns: {
					daily_limit: number;
					resource: string;
					spent: number;
				}[];
			};
			tenant_counts: { Args: { p_tenant: string }; Returns: Json };
			tenant_is_writable: { Args: { p_tenant: string }; Returns: boolean };
			tenant_spend_report: {
				Args: { p_from: string; p_tenant: string; p_to: string };
				Returns: {
					amount: number;
					day: string;
					origin: string;
				}[];
			};
			unblock_member: {
				Args: { p_tenant: string; p_user: string };
				Returns: undefined;
			};
			upsert_discovered_account: {
				Args: {
					p_domain: string;
					p_external_ids: Json;
					p_firmographics: Json;
					p_name: string;
					p_tenant_id: string;
				};
				Returns: string;
			};
			usage_sum: {
				Args: {
					p_resource: string;
					p_run?: string;
					p_since: string;
					p_tenant: string;
				};
				Returns: number;
			};
		};
		Enums: {
			brain_access_level: "lector" | "editor" | "administrador" | "ninguno";
			brain_access_principal: "user" | "members";
			brain_author_kind: "user" | "agent" | "import";
			brain_page_status: "activo" | "borrador" | "archivado";
			brain_skill_action: "publicar" | "retirar";
			config_value_kind: "segmento" | "vector" | "hook" | "idioma";
			connector_capability: "crm" | "leads" | "enrichment" | "brain" | "mail";
			invitation_status: "pending" | "accepted" | "revoked";
			outreach_stage:
				| "a_contactar"
				| "msg1_enviado"
				| "sin_respuesta"
				| "respuesta_neutra"
				| "no_interesado"
				| "en_conversacion"
				| "reunion_agendada"
				| "deal_creado"
				| "cliente"
				| "sin_atribucion";
			queue_item_kind: "msg1" | "followup_2" | "followup_3";
			queue_item_status:
				| "pending"
				| "approved"
				| "rejected"
				| "sent"
				| "failed"
				| "expired";
			run_status:
				| "running"
				| "ok"
				| "failed"
				| "cancelled"
				| "budget_exhausted";
			run_trigger: "chat" | "schedule" | "mcp" | "webhook";
			search_focus_status: "activo" | "agotado" | "cancelado";
			tenant_role: "platform_admin" | "tenant_admin" | "tenant_member";
			work_item_status: "pending" | "running" | "done" | "refused" | "failed";
		};
		CompositeTypes: {
			[_ in never]: never;
		};
	};
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
	keyof Database,
	"public"
>];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
				DefaultSchema["Views"])
		? (DefaultSchema["Tables"] &
				DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		| keyof DefaultSchema["Tables"]
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
		: never = never,
> = DefaultSchemaTableNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
		? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		| keyof DefaultSchema["Enums"]
		| { schema: keyof DatabaseWithoutInternals },
	EnumName extends DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
		: never = never,
> = DefaultSchemaEnumNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
		? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		| keyof DefaultSchema["CompositeTypes"]
		| { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
		: never = never,
> = PublicCompositeTypeNameOrOptions extends {
	schema: keyof DatabaseWithoutInternals;
}
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
		? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	graphql_public: {
		Enums: {},
	},
	public: {
		Enums: {
			brain_access_level: ["lector", "editor", "administrador", "ninguno"],
			brain_access_principal: ["user", "members"],
			brain_author_kind: ["user", "agent", "import"],
			brain_page_status: ["activo", "borrador", "archivado"],
			brain_skill_action: ["publicar", "retirar"],
			config_value_kind: ["segmento", "vector", "hook", "idioma"],
			connector_capability: ["crm", "leads", "enrichment", "brain", "mail"],
			invitation_status: ["pending", "accepted", "revoked"],
			outreach_stage: [
				"a_contactar",
				"msg1_enviado",
				"sin_respuesta",
				"respuesta_neutra",
				"no_interesado",
				"en_conversacion",
				"reunion_agendada",
				"deal_creado",
				"cliente",
				"sin_atribucion",
			],
			queue_item_kind: ["msg1", "followup_2", "followup_3"],
			queue_item_status: [
				"pending",
				"approved",
				"rejected",
				"sent",
				"failed",
				"expired",
			],
			run_status: ["running", "ok", "failed", "cancelled", "budget_exhausted"],
			run_trigger: ["chat", "schedule", "mcp", "webhook"],
			search_focus_status: ["activo", "agotado", "cancelado"],
			tenant_role: ["platform_admin", "tenant_admin", "tenant_member"],
			work_item_status: ["pending", "running", "done", "refused", "failed"],
		},
	},
} as const;
