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
    PostgrestVersion: "12.2.3 (519615d)"
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
      affiliates_tracking: {
        Row: {
          affiliate_id: string
          created_at: string
          data: Json | null
          id: number
          stage: string
          user_id: string
        }
        Insert: {
          affiliate_id: string
          created_at?: string
          data?: Json | null
          id?: number
          stage: string
          user_id: string
        }
        Update: {
          affiliate_id?: string
          created_at?: string
          data?: Json | null
          id?: number
          stage?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliates_tracking_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_tracking_code"]
          },
        ]
      }
      artists: {
        Row: {
          art_bg_scale: number | null
          art_color_index: number | null
          art_image_offset_x: number | null
          art_image_offset_y: number | null
          art_image_scale: number | null
          art_image_url: string | null
          art_shape_index: number | null
          banners: Json
          bio: Json | null
          created_at: string
          display_order: number | null
          featured_order: number | null
          gallery: Json
          hero_video_url: string | null
          id: number
          image_height: number | null
          image_url: string | null
          image_width: number | null
          is_active: boolean
          is_deleted: boolean
          meta_description: string | null
          meta_tags: string | null
          name: string
          name_english: string | null
          preview_text: string | null
          seo_title: string | null
          slug: string
          updated_at: string
          videos: Json
        }
        Insert: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          banners?: Json
          bio?: Json | null
          created_at?: string
          display_order?: number | null
          featured_order?: number | null
          gallery?: Json
          hero_video_url?: string | null
          id?: never
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          is_active?: boolean
          is_deleted?: boolean
          meta_description?: string | null
          meta_tags?: string | null
          name: string
          name_english?: string | null
          preview_text?: string | null
          seo_title?: string | null
          slug: string
          updated_at?: string
          videos?: Json
        }
        Update: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          banners?: Json
          bio?: Json | null
          created_at?: string
          display_order?: number | null
          featured_order?: number | null
          gallery?: Json
          hero_video_url?: string | null
          id?: never
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          is_active?: boolean
          is_deleted?: boolean
          meta_description?: string | null
          meta_tags?: string | null
          name?: string
          name_english?: string | null
          preview_text?: string | null
          seo_title?: string | null
          slug?: string
          updated_at?: string
          videos?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          actor_role: string | null
          changes: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: number
          ip: string | null
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          actor_role?: string | null
          changes?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          ip?: string | null
          metadata?: Json | null
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          art_bg_scale: number | null
          art_color_index: number | null
          art_image_offset_x: number | null
          art_image_offset_y: number | null
          art_image_scale: number | null
          art_image_url: string | null
          art_shape_index: number | null
          by_who: string | null
          created_at: string
          display_order: number
          id: number
          image_height: number | null
          image_url: string | null
          image_width: number | null
          is_active: boolean
          is_deleted: boolean
          main_content: Json | null
          meta_description: string | null
          meta_tags: string | null
          name: string
          preview_text: string | null
          seo_title_tag: string | null
          slug: string
          title: string | null
          updated_at: string
        }
        Insert: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          by_who?: string | null
          created_at?: string
          display_order?: number
          id?: never
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          is_active?: boolean
          is_deleted?: boolean
          main_content?: Json | null
          meta_description?: string | null
          meta_tags?: string | null
          name: string
          preview_text?: string | null
          seo_title_tag?: string | null
          slug: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          by_who?: string | null
          created_at?: string
          display_order?: number
          id?: never
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          is_active?: boolean
          is_deleted?: boolean
          main_content?: Json | null
          meta_description?: string | null
          meta_tags?: string | null
          name?: string
          preview_text?: string | null
          seo_title_tag?: string | null
          slug?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          art_bg_scale: number | null
          art_color_index: number | null
          art_image_offset_x: number | null
          art_image_offset_y: number | null
          art_image_scale: number | null
          art_image_url: string | null
          art_shape_index: number | null
          created_at: string
          display_order: number
          id: number
          image_url: string | null
          is_active: boolean
          is_deleted: boolean
          link_url: string | null
          member_ids: string[]
          name: string
          name_english: string | null
          page_content: Json | null
          parent_id: number | null
          slug: string
          sport: string | null
          subtitle: string | null
          tag: string | null
          updated_at: string
        }
        Insert: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          created_at?: string
          display_order?: number
          id?: never
          image_url?: string | null
          is_active?: boolean
          is_deleted?: boolean
          link_url?: string | null
          member_ids?: string[]
          name: string
          name_english?: string | null
          page_content?: Json | null
          parent_id?: number | null
          slug: string
          sport?: string | null
          subtitle?: string | null
          tag?: string | null
          updated_at?: string
        }
        Update: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          created_at?: string
          display_order?: number
          id?: never
          image_url?: string | null
          is_active?: boolean
          is_deleted?: boolean
          link_url?: string | null
          member_ids?: string[]
          name?: string
          name_english?: string | null
          page_content?: Json | null
          parent_id?: number | null
          slug?: string
          sport?: string | null
          subtitle?: string | null
          tag?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      category_tags: {
        Row: {
          category_id: number
          tag_id: number
        }
        Insert: {
          category_id: number
          tag_id: number
        }
        Update: {
          category_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "category_tags_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "category_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "event_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          discount_type: string
          discount_value: number
          event_id: number | null
          funded_by_commission: boolean
          id: number
          is_active: boolean
          max_uses: number | null
          partner_tracking_code: string | null
          times_paid: number
          times_used: number
          valid_until: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          discount_type: string
          discount_value: number
          event_id?: number | null
          funded_by_commission?: boolean
          id?: never
          is_active?: boolean
          max_uses?: number | null
          partner_tracking_code?: string | null
          times_paid?: number
          times_used?: number
          valid_until?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          discount_type?: string
          discount_value?: number
          event_id?: number | null
          funded_by_commission?: boolean
          id?: never
          is_active?: boolean
          max_uses?: number | null
          partner_tracking_code?: string | null
          times_paid?: number
          times_used?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_partner_tracking_code_fkey"
            columns: ["partner_tracking_code"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_tracking_code"]
          },
        ]
      }
      event_categories_legacy: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: number
          image_url: string | null
          is_active: boolean
          is_deleted: boolean
          name: string
          name_english: string | null
          parent_id: number | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: never
          image_url?: string | null
          is_active?: boolean
          is_deleted?: boolean
          name: string
          name_english?: string | null
          parent_id?: number | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: never
          image_url?: string | null
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          name_english?: string | null
          parent_id?: number | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "event_categories_legacy"
            referencedColumns: ["id"]
          },
        ]
      }
      event_category_links_legacy: {
        Row: {
          category_id: number
          event_id: number
        }
        Insert: {
          category_id: number
          event_id: number
        }
        Update: {
          category_id?: number
          event_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "event_categories_legacy"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_category_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tag_links: {
        Row: {
          event_id: number
          tag_id: number
        }
        Insert: {
          event_id: number
          tag_id: number
        }
        Update: {
          event_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_tag_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tag_links_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "event_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tags: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          is_deleted: boolean
          name: string
          name_english: string | null
          slug: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          is_active?: boolean
          is_deleted?: boolean
          name: string
          name_english?: string | null
          slug: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          name_english?: string | null
          slug?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          art_bg_scale: number | null
          art_color_index: number | null
          art_image_offset_x: number | null
          art_image_offset_y: number | null
          art_image_scale: number | null
          art_image_url: string | null
          art_shape_index: number | null
          base_flight_price: number
          base_hotel_price: number
          campaign_banner_url: string | null
          campaign_generated_at: string | null
          campaign_image_url: string | null
          campaign_input_hash: string | null
          campaign_skip_reason: string | null
          campaign_video_url: string | null
          card_image_url: string | null
          comp_pricing: Json | null
          created_at: string
          date: string
          def_date_depart: string
          def_date_return: string
          description: string
          event_additional_markup: number | null
          id: number
          is_deleted: string | null
          is_prioritized: boolean | null
          is_test: boolean
          location: Json | null
          locked_flight_id: number | null
          map_image_url: string | null
          markup_flight: number | null
          markup_hotel: number | null
          markup_ticket: number | null
          name: string
          name_english: string | null
          skip_flight: boolean | null
          skip_flight_markup: number | null
          skip_hotel_markup: number | null
          tags: string | null
          ticket_only_markup: number | null
          tickets_and_rates: Json[]
          tx_excluded_sections: string[] | null
          type: string
          usual_price: number
        }
        Insert: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          base_flight_price: number
          base_hotel_price: number
          campaign_banner_url?: string | null
          campaign_generated_at?: string | null
          campaign_image_url?: string | null
          campaign_input_hash?: string | null
          campaign_skip_reason?: string | null
          campaign_video_url?: string | null
          card_image_url?: string | null
          comp_pricing?: Json | null
          created_at?: string
          date: string
          def_date_depart: string
          def_date_return: string
          description: string
          event_additional_markup?: number | null
          id?: number
          is_deleted?: string | null
          is_prioritized?: boolean | null
          is_test?: boolean
          location?: Json | null
          locked_flight_id?: number | null
          map_image_url?: string | null
          markup_flight?: number | null
          markup_hotel?: number | null
          markup_ticket?: number | null
          name: string
          name_english?: string | null
          skip_flight?: boolean | null
          skip_flight_markup?: number | null
          skip_hotel_markup?: number | null
          tags?: string | null
          ticket_only_markup?: number | null
          tickets_and_rates: Json[]
          tx_excluded_sections?: string[] | null
          type?: string
          usual_price: number
        }
        Update: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          base_flight_price?: number
          base_hotel_price?: number
          campaign_banner_url?: string | null
          campaign_generated_at?: string | null
          campaign_image_url?: string | null
          campaign_input_hash?: string | null
          campaign_skip_reason?: string | null
          campaign_video_url?: string | null
          card_image_url?: string | null
          comp_pricing?: Json | null
          created_at?: string
          date?: string
          def_date_depart?: string
          def_date_return?: string
          description?: string
          event_additional_markup?: number | null
          id?: number
          is_deleted?: string | null
          is_prioritized?: boolean | null
          is_test?: boolean
          location?: Json | null
          locked_flight_id?: number | null
          map_image_url?: string | null
          markup_flight?: number | null
          markup_hotel?: number | null
          markup_ticket?: number | null
          name?: string
          name_english?: string | null
          skip_flight?: boolean | null
          skip_flight_markup?: number | null
          skip_hotel_markup?: number | null
          tags?: string | null
          ticket_only_markup?: number | null
          tickets_and_rates?: Json[]
          tx_excluded_sections?: string[] | null
          type?: string
          usual_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "events_locked_flight_id_fkey"
            columns: ["locked_flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_event_allocations: {
        Row: {
          allocated_seats: number
          created_at: string
          event_id: number
          flight_id: number
          id: number
        }
        Insert: {
          allocated_seats: number
          created_at?: string
          event_id: number
          flight_id: number
          id?: never
        }
        Update: {
          allocated_seats?: number
          created_at?: string
          event_id?: number
          flight_id?: number
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "flight_event_allocations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flight_event_allocations_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
        ]
      }
      flights: {
        Row: {
          aircraft_type: string | null
          airline_code: string
          block_status: string | null
          cabin_bag_kg: number | null
          cabin_class: string | null
          checked_bag_kg: number | null
          consumed_quantity: number
          cost_currency: string | null
          cost_price: number | null
          duration: string
          event_ids: number[]
          group_code: string | null
          handled_by: string | null
          id: number
          inbound_arrival_airport: string
          inbound_arrival_time: string
          inbound_cabin_bags_included: boolean
          inbound_check_bags_included: boolean
          inbound_departure_airport: string
          inbound_departure_time: string
          inbound_duration: string
          inbound_flight_number: string
          inbound_stop_airport: string | null
          inbound_stop_duration: string | null
          initial_quantity: number
          is_deleted: boolean
          last_cancellation_date: string | null
          metadata_iata: string
          metadata_logo: string
          metadata_name: string
          notes: string | null
          option_expiry: string | null
          outbound_arrival_airport: string
          outbound_arrival_time: string
          outbound_cabin_bags_included: boolean
          outbound_check_bags_included: boolean
          outbound_departure_airport: string
          outbound_departure_time: string
          outbound_duration: string
          outbound_flight_number: string
          outbound_stop_airport: string | null
          outbound_stop_duration: string | null
          payment_deadline: string | null
          pnr: string | null
          price: number
          series_id: string | null
          series_name: string | null
          stops: number
          supplier: string | null
          ticketing_deadline: string | null
        }
        Insert: {
          aircraft_type?: string | null
          airline_code: string
          block_status?: string | null
          cabin_bag_kg?: number | null
          cabin_class?: string | null
          checked_bag_kg?: number | null
          consumed_quantity?: number
          cost_currency?: string | null
          cost_price?: number | null
          duration: string
          event_ids?: number[]
          group_code?: string | null
          handled_by?: string | null
          id?: number
          inbound_arrival_airport: string
          inbound_arrival_time: string
          inbound_cabin_bags_included: boolean
          inbound_check_bags_included: boolean
          inbound_departure_airport: string
          inbound_departure_time: string
          inbound_duration: string
          inbound_flight_number: string
          inbound_stop_airport?: string | null
          inbound_stop_duration?: string | null
          initial_quantity: number
          is_deleted?: boolean
          last_cancellation_date?: string | null
          metadata_iata: string
          metadata_logo: string
          metadata_name: string
          notes?: string | null
          option_expiry?: string | null
          outbound_arrival_airport: string
          outbound_arrival_time: string
          outbound_cabin_bags_included: boolean
          outbound_check_bags_included: boolean
          outbound_departure_airport: string
          outbound_departure_time: string
          outbound_duration: string
          outbound_flight_number: string
          outbound_stop_airport?: string | null
          outbound_stop_duration?: string | null
          payment_deadline?: string | null
          pnr?: string | null
          price: number
          series_id?: string | null
          series_name?: string | null
          stops: number
          supplier?: string | null
          ticketing_deadline?: string | null
        }
        Update: {
          aircraft_type?: string | null
          airline_code?: string
          block_status?: string | null
          cabin_bag_kg?: number | null
          cabin_class?: string | null
          checked_bag_kg?: number | null
          consumed_quantity?: number
          cost_currency?: string | null
          cost_price?: number | null
          duration?: string
          event_ids?: number[]
          group_code?: string | null
          handled_by?: string | null
          id?: number
          inbound_arrival_airport?: string
          inbound_arrival_time?: string
          inbound_cabin_bags_included?: boolean
          inbound_check_bags_included?: boolean
          inbound_departure_airport?: string
          inbound_departure_time?: string
          inbound_duration?: string
          inbound_flight_number?: string
          inbound_stop_airport?: string | null
          inbound_stop_duration?: string | null
          initial_quantity?: number
          is_deleted?: boolean
          last_cancellation_date?: string | null
          metadata_iata?: string
          metadata_logo?: string
          metadata_name?: string
          notes?: string | null
          option_expiry?: string | null
          outbound_arrival_airport?: string
          outbound_arrival_time?: string
          outbound_cabin_bags_included?: boolean
          outbound_check_bags_included?: boolean
          outbound_departure_airport?: string
          outbound_departure_time?: string
          outbound_duration?: string
          outbound_flight_number?: string
          outbound_stop_airport?: string | null
          outbound_stop_duration?: string | null
          payment_deadline?: string | null
          pnr?: string | null
          price?: number
          series_id?: string | null
          series_name?: string | null
          stops?: number
          supplier?: string | null
          ticketing_deadline?: string | null
        }
        Relationships: []
      }
      football_logos: {
        Row: {
          created_at: string
          id: number
          logo_url: string
          name_english: string
          name_hebrew: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          logo_url: string
          name_english: string
          name_hebrew?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          logo_url?: string
          name_english?: string
          name_hebrew?: string | null
        }
        Relationships: []
      }
      football_teams: {
        Row: {
          art_bg_scale: number | null
          art_color_index: number | null
          art_image_offset_x: number | null
          art_image_offset_y: number | null
          art_image_scale: number | null
          art_image_url: string | null
          art_shape_index: number | null
          banners: Json
          bio: Json | null
          created_at: string
          display_order: number | null
          featured_order: number | null
          gallery: Json
          hero_video_url: string | null
          id: number
          image_height: number | null
          image_url: string | null
          image_width: number | null
          is_active: boolean
          is_deleted: boolean
          logo_url: string | null
          meta_description: string | null
          meta_tags: string | null
          name: string
          name_english: string | null
          preview_text: string | null
          seo_title: string | null
          slug: string
          updated_at: string
          videos: Json
        }
        Insert: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          banners?: Json
          bio?: Json | null
          created_at?: string
          display_order?: number | null
          featured_order?: number | null
          gallery?: Json
          hero_video_url?: string | null
          id?: never
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          is_active?: boolean
          is_deleted?: boolean
          logo_url?: string | null
          meta_description?: string | null
          meta_tags?: string | null
          name: string
          name_english?: string | null
          preview_text?: string | null
          seo_title?: string | null
          slug: string
          updated_at?: string
          videos?: Json
        }
        Update: {
          art_bg_scale?: number | null
          art_color_index?: number | null
          art_image_offset_x?: number | null
          art_image_offset_y?: number | null
          art_image_scale?: number | null
          art_image_url?: string | null
          art_shape_index?: number | null
          banners?: Json
          bio?: Json | null
          created_at?: string
          display_order?: number | null
          featured_order?: number | null
          gallery?: Json
          hero_video_url?: string | null
          id?: never
          image_height?: number | null
          image_url?: string | null
          image_width?: number | null
          is_active?: boolean
          is_deleted?: boolean
          logo_url?: string | null
          meta_description?: string | null
          meta_tags?: string | null
          name?: string
          name_english?: string | null
          preview_text?: string | null
          seo_title?: string | null
          slug?: string
          updated_at?: string
          videos?: Json
        }
        Relationships: []
      }
      form_fields: {
        Row: {
          config: Json
          created_at: string
          form_id: number
          help_en: string | null
          help_he: string | null
          id: number
          label_en: string
          label_he: string | null
          options: Json
          placeholder_en: string | null
          placeholder_he: string | null
          position: number
          required: boolean
          staff_only: boolean
          type: string
        }
        Insert: {
          config?: Json
          created_at?: string
          form_id: number
          help_en?: string | null
          help_he?: string | null
          id?: never
          label_en?: string
          label_he?: string | null
          options?: Json
          placeholder_en?: string | null
          placeholder_he?: string | null
          position?: number
          required?: boolean
          staff_only?: boolean
          type: string
        }
        Update: {
          config?: Json
          created_at?: string
          form_id?: number
          help_en?: string | null
          help_he?: string | null
          id?: never
          label_en?: string
          label_he?: string | null
          options?: Json
          placeholder_en?: string | null
          placeholder_he?: string | null
          position?: number
          required?: boolean
          staff_only?: boolean
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_invites: {
        Row: {
          created_at: string
          event_id: number | null
          form_id: number
          id: number
          label: string | null
          lang: string
          multi_use: boolean
          opened_at: string | null
          prefill: Json
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          reservation_id: number | null
          send_error: string | null
          sent_at: string | null
          submitted_at: string | null
          token: string
          trip_code_num: string | null
          trip_code_prefix: string | null
        }
        Insert: {
          created_at?: string
          event_id?: number | null
          form_id: number
          id?: never
          label?: string | null
          lang?: string
          multi_use?: boolean
          opened_at?: string | null
          prefill?: Json
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          reservation_id?: number | null
          send_error?: string | null
          sent_at?: string | null
          submitted_at?: string | null
          token: string
          trip_code_num?: string | null
          trip_code_prefix?: string | null
        }
        Update: {
          created_at?: string
          event_id?: number | null
          form_id?: number
          id?: never
          label?: string | null
          lang?: string
          multi_use?: boolean
          opened_at?: string | null
          prefill?: Json
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          reservation_id?: number | null
          send_error?: string | null
          sent_at?: string | null
          submitted_at?: string | null
          token?: string
          trip_code_num?: string | null
          trip_code_prefix?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_invites_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_responses: {
        Row: {
          answers: Json
          form_id: number
          id: number
          invite_id: number | null
          ip: string | null
          lang: string
          submitted_at: string
          user_agent: string | null
        }
        Insert: {
          answers?: Json
          form_id: number
          id?: never
          invite_id?: number | null
          ip?: string | null
          lang?: string
          submitted_at?: string
          user_agent?: string | null
        }
        Update: {
          answers?: Json
          form_id?: number
          id?: never
          invite_id?: number | null
          ip?: string | null
          lang?: string
          submitted_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_invite_id_fkey"
            columns: ["invite_id"]
            isOneToOne: false
            referencedRelation: "form_invites"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          accent_color: string
          allow_multiple: boolean
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          default_lang: string
          description_en: string | null
          description_he: string | null
          id: number
          is_deleted: string | null
          languages: string
          logo_url: string | null
          operator_visible: boolean
          review_link_url: string | null
          review_min_avg: number | null
          slug: string
          status: string
          thank_you_en: string | null
          thank_you_he: string | null
          theme: string
          title_en: string
          title_he: string | null
          updated_at: string
        }
        Insert: {
          accent_color?: string
          allow_multiple?: boolean
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          default_lang?: string
          description_en?: string | null
          description_he?: string | null
          id?: never
          is_deleted?: string | null
          languages?: string
          logo_url?: string | null
          operator_visible?: boolean
          review_link_url?: string | null
          review_min_avg?: number | null
          slug: string
          status?: string
          thank_you_en?: string | null
          thank_you_he?: string | null
          theme?: string
          title_en: string
          title_he?: string | null
          updated_at?: string
        }
        Update: {
          accent_color?: string
          allow_multiple?: boolean
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          default_lang?: string
          description_en?: string | null
          description_he?: string | null
          id?: never
          is_deleted?: string | null
          languages?: string
          logo_url?: string | null
          operator_visible?: boolean
          review_link_url?: string | null
          review_min_avg?: number | null
          slug?: string
          status?: string
          thank_you_en?: string | null
          thank_you_he?: string | null
          theme?: string
          title_en?: string
          title_he?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      hotels: {
        Row: {
          _id: string
          address: string
          amenity_groups: Json
          city: string
          created_at: string
          guest_detailed_ratings: Json | null
          guest_rating: number | null
          guest_rating_updated_at: string | null
          guest_review_count: number | null
          hid: number
          images_ext: Json
          kind: string | null
          latitude: number
          longitude: number
          name: string
          room_groups: Json
          star_rating: number
        }
        Insert: {
          _id: string
          address: string
          amenity_groups: Json
          city: string
          created_at?: string
          guest_detailed_ratings?: Json | null
          guest_rating?: number | null
          guest_rating_updated_at?: string | null
          guest_review_count?: number | null
          hid: number
          images_ext: Json
          kind?: string | null
          latitude: number
          longitude: number
          name: string
          room_groups: Json
          star_rating: number
        }
        Update: {
          _id?: string
          address?: string
          amenity_groups?: Json
          city?: string
          created_at?: string
          guest_detailed_ratings?: Json | null
          guest_rating?: number | null
          guest_rating_updated_at?: string | null
          guest_review_count?: number | null
          hid?: number
          images_ext?: Json
          kind?: string | null
          latitude?: number
          longitude?: number
          name?: string
          room_groups?: Json
          star_rating?: number
        }
        Relationships: []
      }
      live_events: {
        Row: {
          categories: Json | null
          city_id: number | null
          city_name: string | null
          country_id: number | null
          country_name: string | null
          created_at: string | null
          currency: number
          event_id: number
          event_name: string
          event_name_heb: string | null
          event_type: string
          iata: string | null
          is_active: boolean | null
          is_show_date_finale: boolean | null
          last_synced: string | null
          passport_required: boolean | null
          performers: Json | null
          primary_category: string | null
          show_date: string
          show_date_remarks: string | null
          stop_selling_margin: number | null
          street_address: string | null
          street_address_heb: string | null
          ticket_categories: Json | null
          updated_at: string | null
          venue_map_heb_url: string | null
          venue_map_url: string | null
          venues: Json | null
        }
        Insert: {
          categories?: Json | null
          city_id?: number | null
          city_name?: string | null
          country_id?: number | null
          country_name?: string | null
          created_at?: string | null
          currency: number
          event_id: number
          event_name: string
          event_name_heb?: string | null
          event_type: string
          iata?: string | null
          is_active?: boolean | null
          is_show_date_finale?: boolean | null
          last_synced?: string | null
          passport_required?: boolean | null
          performers?: Json | null
          primary_category?: string | null
          show_date: string
          show_date_remarks?: string | null
          stop_selling_margin?: number | null
          street_address?: string | null
          street_address_heb?: string | null
          ticket_categories?: Json | null
          updated_at?: string | null
          venue_map_heb_url?: string | null
          venue_map_url?: string | null
          venues?: Json | null
        }
        Update: {
          categories?: Json | null
          city_id?: number | null
          city_name?: string | null
          country_id?: number | null
          country_name?: string | null
          created_at?: string | null
          currency?: number
          event_id?: number
          event_name?: string
          event_name_heb?: string | null
          event_type?: string
          iata?: string | null
          is_active?: boolean | null
          is_show_date_finale?: boolean | null
          last_synced?: string | null
          passport_required?: boolean | null
          performers?: Json | null
          primary_category?: string | null
          show_date?: string
          show_date_remarks?: string | null
          stop_selling_margin?: number | null
          street_address?: string | null
          street_address_heb?: string | null
          ticket_categories?: Json | null
          updated_at?: string | null
          venue_map_heb_url?: string | null
          venue_map_url?: string | null
          venues?: Json | null
        }
        Relationships: []
      }
      locations: {
        Row: {
          city_iata: string | null
          country_code: string | null
          created_at: string | null
          id: number
          latitude: number
          longitude: number
          name: string
          updated_at: string | null
        }
        Insert: {
          city_iata?: string | null
          country_code?: string | null
          created_at?: string | null
          id?: number
          latitude: number
          longitude: number
          name: string
          updated_at?: string | null
        }
        Update: {
          city_iata?: string | null
          country_code?: string | null
          created_at?: string | null
          id?: number
          latitude?: number
          longitude?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      offline_hotel_rooms: {
        Row: {
          acc_no: string | null
          created_at: string
          hotel_id: number
          id: number
          is_booked: boolean
          last_cancellation_date: string | null
          meal_plan: string | null
          notes: string | null
          order_no: string | null
          price: number
          reservation_id: number | null
          room_type: string
          supplier: string | null
        }
        Insert: {
          acc_no?: string | null
          created_at?: string
          hotel_id: number
          id?: never
          is_booked?: boolean
          last_cancellation_date?: string | null
          meal_plan?: string | null
          notes?: string | null
          order_no?: string | null
          price: number
          reservation_id?: number | null
          room_type: string
          supplier?: string | null
        }
        Update: {
          acc_no?: string | null
          created_at?: string
          hotel_id?: number
          id?: never
          is_booked?: boolean
          last_cancellation_date?: string | null
          meal_plan?: string | null
          notes?: string | null
          order_no?: string | null
          price?: number
          reservation_id?: number | null
          room_type?: string
          supplier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_hotel_rooms_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "offline_hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_hotels: {
        Row: {
          check_in: string
          check_out: string
          city: string
          consumed_rooms: number
          created_at: string | null
          event_ids: number[]
          flight_ids: number[]
          guest_rating: number | null
          guest_review_count: number | null
          hid: number | null
          hotel_name: string
          id: number
          is_deleted: boolean | null
          last_cancellation_date: string | null
          meal_plan: string | null
          notes: string | null
          num_rooms: number
          price: number
          room_type: string
        }
        Insert: {
          check_in: string
          check_out: string
          city: string
          consumed_rooms?: number
          created_at?: string | null
          event_ids?: number[]
          flight_ids?: number[]
          guest_rating?: number | null
          guest_review_count?: number | null
          hid?: number | null
          hotel_name: string
          id?: number
          is_deleted?: boolean | null
          last_cancellation_date?: string | null
          meal_plan?: string | null
          notes?: string | null
          num_rooms?: number
          price: number
          room_type: string
        }
        Update: {
          check_in?: string
          check_out?: string
          city?: string
          consumed_rooms?: number
          created_at?: string | null
          event_ids?: number[]
          flight_ids?: number[]
          guest_rating?: number | null
          guest_review_count?: number | null
          hid?: number | null
          hotel_name?: string
          id?: number
          is_deleted?: boolean | null
          last_cancellation_date?: string | null
          meal_plan?: string | null
          notes?: string | null
          num_rooms?: number
          price?: number
          room_type?: string
        }
        Relationships: []
      }
      p1_events: {
        Row: {
          category: string
          checkout_link: string | null
          compare_price_ticket_hotel: number | null
          compare_price_ticket_only: number | null
          created_at: string | null
          date_confirmed: boolean | null
          date_end: string | null
          date_start: string
          event_id: string
          has_available_tickets: boolean | null
          is_active: boolean | null
          is_advertisable: boolean | null
          last_synced: string | null
          series_id: string | null
          series_name: string | null
          stock: number | null
          tickets: Json | null
          title: string
          title_english: string
          updated_at: string | null
          venue_city: string
          venue_country_code: string | null
          venue_latitude: number | null
          venue_longitude: number | null
          venue_name: string
        }
        Insert: {
          category: string
          checkout_link?: string | null
          compare_price_ticket_hotel?: number | null
          compare_price_ticket_only?: number | null
          created_at?: string | null
          date_confirmed?: boolean | null
          date_end?: string | null
          date_start: string
          event_id: string
          has_available_tickets?: boolean | null
          is_active?: boolean | null
          is_advertisable?: boolean | null
          last_synced?: string | null
          series_id?: string | null
          series_name?: string | null
          stock?: number | null
          tickets?: Json | null
          title: string
          title_english: string
          updated_at?: string | null
          venue_city: string
          venue_country_code?: string | null
          venue_latitude?: number | null
          venue_longitude?: number | null
          venue_name: string
        }
        Update: {
          category?: string
          checkout_link?: string | null
          compare_price_ticket_hotel?: number | null
          compare_price_ticket_only?: number | null
          created_at?: string | null
          date_confirmed?: boolean | null
          date_end?: string | null
          date_start?: string
          event_id?: string
          has_available_tickets?: boolean | null
          is_active?: boolean | null
          is_advertisable?: boolean | null
          last_synced?: string | null
          series_id?: string | null
          series_name?: string | null
          stock?: number | null
          tickets?: Json | null
          title?: string
          title_english?: string
          updated_at?: string | null
          venue_city?: string
          venue_country_code?: string | null
          venue_latitude?: number | null
          venue_longitude?: number | null
          venue_name?: string
        }
        Relationships: []
      }
      partner_credit_redemptions: {
        Row: {
          amount_usd: number
          coupon_code: string
          coupon_id: number | null
          created_at: string
          created_by: string | null
          id: number
          partner_tracking_code: string
        }
        Insert: {
          amount_usd: number
          coupon_code: string
          coupon_id?: number | null
          created_at?: string
          created_by?: string | null
          id?: never
          partner_tracking_code: string
        }
        Update: {
          amount_usd?: number
          coupon_code?: string
          coupon_id?: number | null
          created_at?: string
          created_by?: string | null
          id?: never
          partner_tracking_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_credit_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_credit_redemptions_partner_tracking_code_fkey"
            columns: ["partner_tracking_code"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_tracking_code"]
          },
        ]
      }
      partners: {
        Row: {
          bank_details: Json | null
          commission: number
          commission_type: string
          coupon_cap: number | null
          created_at: string
          credit_accrual_start: string
          credit_per_ticket: number
          email: string
          is_active: boolean
          name_hebrew: string | null
          partner_tracking_code: string
          password: string
          payment_card: Json | null
          supplier_number: number | null
          type: string | null
          user_discount: number
          voucher_payment_allowed: boolean
        }
        Insert: {
          bank_details?: Json | null
          commission?: number
          commission_type?: string
          coupon_cap?: number | null
          created_at: string
          credit_accrual_start?: string
          credit_per_ticket?: number
          email: string
          is_active?: boolean
          name_hebrew?: string | null
          partner_tracking_code: string
          password: string
          payment_card?: Json | null
          supplier_number?: number | null
          type?: string | null
          user_discount?: number
          voucher_payment_allowed?: boolean
        }
        Update: {
          bank_details?: Json | null
          commission?: number
          commission_type?: string
          coupon_cap?: number | null
          created_at?: string
          credit_accrual_start?: string
          credit_per_ticket?: number
          email?: string
          is_active?: boolean
          name_hebrew?: string | null
          partner_tracking_code?: string
          password?: string
          payment_card?: Json | null
          supplier_number?: number | null
          type?: string | null
          user_discount?: number
          voucher_payment_allowed?: boolean
        }
        Relationships: []
      }
      prepared_packages: {
        Row: {
          allow_edit: boolean
          created_at: string
          created_by: string | null
          event_id: number
          event_order_info: Json
          flight_order_info: Json | null
          flight_skipped: boolean
          hotel_order_info: Json | null
          hotel_skipped: boolean
          id: number
          num_travelers: number
          partner_tracking_code: string
          share_token: string
        }
        Insert: {
          allow_edit?: boolean
          created_at?: string
          created_by?: string | null
          event_id: number
          event_order_info: Json
          flight_order_info?: Json | null
          flight_skipped?: boolean
          hotel_order_info?: Json | null
          hotel_skipped?: boolean
          id?: never
          num_travelers?: number
          partner_tracking_code: string
          share_token: string
        }
        Update: {
          allow_edit?: boolean
          created_at?: string
          created_by?: string | null
          event_id?: number
          event_order_info?: Json
          flight_order_info?: Json | null
          flight_skipped?: boolean
          hotel_order_info?: Json | null
          hotel_skipped?: boolean
          id?: never
          num_travelers?: number
          partner_tracking_code?: string
          share_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "prepared_packages_partner_tracking_code_fkey"
            columns: ["partner_tracking_code"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_tracking_code"]
          },
        ]
      }
      quotes: {
        Row: {
          base_unit_price: number | null
          created_at: string
          created_by: string
          currency: string
          customer_name: string | null
          event_id: number | null
          id: number
          line_items: Json
          notes: string | null
          partner_tracking_code: string | null
          payment_link: string | null
          pdf_storage_path: string | null
          status: string
          title: string | null
          total: number | null
          valid_until: string | null
        }
        Insert: {
          base_unit_price?: number | null
          created_at?: string
          created_by: string
          currency?: string
          customer_name?: string | null
          event_id?: number | null
          id?: never
          line_items?: Json
          notes?: string | null
          partner_tracking_code?: string | null
          payment_link?: string | null
          pdf_storage_path?: string | null
          status?: string
          title?: string | null
          total?: number | null
          valid_until?: string | null
        }
        Update: {
          base_unit_price?: number | null
          created_at?: string
          created_by?: string
          currency?: string
          customer_name?: string | null
          event_id?: number | null
          id?: never
          line_items?: Json
          notes?: string | null
          partner_tracking_code?: string | null
          payment_link?: string | null
          pdf_storage_path?: string | null
          status?: string
          title?: string | null
          total?: number | null
          valid_until?: string | null
        }
        Relationships: []
      }
      reservations: {
        Row: {
          accounting_number: number | null
          aff_partner_tracking_code: string | null
          agent_card_discount_ils: number | null
          agent_user_id: string | null
          billed_at: string | null
          booking_reference: string | null
          comments: string | null
          commission_rate: number | null
          commission_type: string | null
          confirmation_email_sent: boolean | null
          coupon_code: string | null
          coupon_discount_usd: number | null
          created_at: string
          event_id: number
          event_order_info: Json
          exchange_rate_usd_ils_100: number | null
          final_purchase_price_ils: number | null
          flight_order_info: Json
          gtmIdnts: Json | null
          hotel_order_info: Json
          id: number
          is_deleted: string | null
          main_contact_email: string
          main_contact_first_name: string
          main_contact_last_name: string
          main_contact_phone_number: string
          more_pax_info: Json[] | null
          offline_flight_cost: number | null
          offline_flight_id: number | null
          offline_hotel_cost: number | null
          offline_hotel_id: number | null
          offline_hotel_ids: number[] | null
          partner_settlement_method: string | null
          payment_info: Json | null
          quote_id: number | null
          source_share_token: string | null
          status: string
          travel_materials_sent_at: string | null
          user_shown_price: number
          voucher_state: string | null
        }
        Insert: {
          accounting_number?: number | null
          aff_partner_tracking_code?: string | null
          agent_card_discount_ils?: number | null
          agent_user_id?: string | null
          billed_at?: string | null
          booking_reference?: string | null
          comments?: string | null
          commission_rate?: number | null
          commission_type?: string | null
          confirmation_email_sent?: boolean | null
          coupon_code?: string | null
          coupon_discount_usd?: number | null
          created_at?: string
          event_id: number
          event_order_info: Json
          exchange_rate_usd_ils_100?: number | null
          final_purchase_price_ils?: number | null
          flight_order_info: Json
          gtmIdnts?: Json | null
          hotel_order_info: Json
          id?: number
          is_deleted?: string | null
          main_contact_email: string
          main_contact_first_name: string
          main_contact_last_name: string
          main_contact_phone_number: string
          more_pax_info?: Json[] | null
          offline_flight_cost?: number | null
          offline_flight_id?: number | null
          offline_hotel_cost?: number | null
          offline_hotel_id?: number | null
          offline_hotel_ids?: number[] | null
          partner_settlement_method?: string | null
          payment_info?: Json | null
          quote_id?: number | null
          source_share_token?: string | null
          status?: string
          travel_materials_sent_at?: string | null
          user_shown_price: number
          voucher_state?: string | null
        }
        Update: {
          accounting_number?: number | null
          aff_partner_tracking_code?: string | null
          agent_card_discount_ils?: number | null
          agent_user_id?: string | null
          billed_at?: string | null
          booking_reference?: string | null
          comments?: string | null
          commission_rate?: number | null
          commission_type?: string | null
          confirmation_email_sent?: boolean | null
          coupon_code?: string | null
          coupon_discount_usd?: number | null
          created_at?: string
          event_id?: number
          event_order_info?: Json
          exchange_rate_usd_ils_100?: number | null
          final_purchase_price_ils?: number | null
          flight_order_info?: Json
          gtmIdnts?: Json | null
          hotel_order_info?: Json
          id?: number
          is_deleted?: string | null
          main_contact_email?: string
          main_contact_first_name?: string
          main_contact_last_name?: string
          main_contact_phone_number?: string
          more_pax_info?: Json[] | null
          offline_flight_cost?: number | null
          offline_flight_id?: number | null
          offline_hotel_cost?: number | null
          offline_hotel_id?: number | null
          offline_hotel_ids?: number[] | null
          partner_settlement_method?: string | null
          payment_info?: Json | null
          quote_id?: number | null
          source_share_token?: string | null
          status?: string
          travel_materials_sent_at?: string | null
          user_shown_price?: number
          voucher_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_offline_flight_id_fkey"
            columns: ["offline_flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_offline_hotel_id_fkey"
            columns: ["offline_hotel_id"]
            isOneToOne: false
            referencedRelation: "offline_hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_rules: {
        Row: {
          created_at: string
          field: string
          id: number
          is_active: boolean
          pattern: string
          tag_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: never
          is_active?: boolean
          pattern: string
          tag_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: never
          is_active?: boolean
          pattern?: string
          tag_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tag_rules_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "event_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      tixstock_events: {
        Row: {
          category_name: string | null
          city_name: string | null
          country_code: string | null
          created_at: string | null
          event_id: string
          event_name: string
          event_status: string | null
          is_active: boolean | null
          last_synced: string | null
          performers: Json | null
          show_date: string
          sub_categories: Json | null
          ticket_count: number | null
          updated_at: string | null
          venue_data: Json | null
          venue_map_url: string | null
          venue_name: string | null
        }
        Insert: {
          category_name?: string | null
          city_name?: string | null
          country_code?: string | null
          created_at?: string | null
          event_id: string
          event_name: string
          event_status?: string | null
          is_active?: boolean | null
          last_synced?: string | null
          performers?: Json | null
          show_date: string
          sub_categories?: Json | null
          ticket_count?: number | null
          updated_at?: string | null
          venue_data?: Json | null
          venue_map_url?: string | null
          venue_name?: string | null
        }
        Update: {
          category_name?: string | null
          city_name?: string | null
          country_code?: string | null
          created_at?: string | null
          event_id?: string
          event_name?: string
          event_status?: string | null
          is_active?: boolean | null
          last_synced?: string | null
          performers?: Json | null
          show_date?: string
          sub_categories?: Json | null
          ticket_count?: number | null
          updated_at?: string | null
          venue_data?: Json | null
          venue_map_url?: string | null
          venue_name?: string | null
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          agent_slug: string | null
          contract_url: string | null
          created_at: string
          created_by: string | null
          display_name: string | null
          email: string
          id: string
          is_active: boolean
          logo_url: string | null
          partner_tracking_code: string | null
          phone: string | null
          role: string
        }
        Insert: {
          agent_slug?: string | null
          contract_url?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email: string
          id: string
          is_active?: boolean
          logo_url?: string | null
          partner_tracking_code?: string | null
          phone?: string | null
          role: string
        }
        Update: {
          agent_slug?: string | null
          contract_url?: string | null
          created_at?: string
          created_by?: string | null
          display_name?: string | null
          email?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          partner_tracking_code?: string | null
          phone?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_partner_tracking_code_fkey"
            columns: ["partner_tracking_code"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["partner_tracking_code"]
          },
        ]
      }
      user_table_preferences: {
        Row: {
          preferences: Json
          table_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          preferences?: Json
          table_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          preferences?: Json
          table_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      utm_touches: {
        Row: {
          created_at: string
          fbclid: string | null
          gclid: string | null
          id: number
          is_influencer: boolean
          position: number
          reservation_id: number
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visited_at: string | null
        }
        Insert: {
          created_at?: string
          fbclid?: string | null
          gclid?: string | null
          id?: never
          is_influencer?: boolean
          position: number
          reservation_id: number
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visited_at?: string | null
        }
        Update: {
          created_at?: string
          fbclid?: string | null
          gclid?: string | null
          id?: never
          is_influencer?: boolean
          position?: number
          reservation_id?: number
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visited_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "utm_touches_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      xs2e_events: {
        Row: {
          city: string | null
          created: string | null
          created_at: string | null
          date_confirmed: boolean | null
          date_start: string
          date_start_main_event: string | null
          date_stop: string
          date_stop_main_event: string | null
          event_description: string | null
          event_description_heb: string | null
          event_id: string
          event_name: string
          event_name_heb: string | null
          event_status: string
          hometeam_id: string | null
          hometeam_name: string | null
          is_popular: boolean | null
          iso_country: string | null
          latitude: number | null
          location_id: string | null
          longitude: number | null
          max_ticket_price_eur: number | null
          min_ticket_price_eur: number | null
          number_of_tickets: number | null
          sales_periods: Json | null
          season: string | null
          slug: string | null
          sport_type: string | null
          tournament_id: string
          tournament_name: string
          tournament_name_heb: string | null
          tournament_type: string | null
          updated: string | null
          updated_at: string | null
          venue_id: string
          venue_name: string
          venue_name_heb: string | null
          visiting_id: string | null
          visiting_name: string | null
        }
        Insert: {
          city?: string | null
          created?: string | null
          created_at?: string | null
          date_confirmed?: boolean | null
          date_start: string
          date_start_main_event?: string | null
          date_stop: string
          date_stop_main_event?: string | null
          event_description?: string | null
          event_description_heb?: string | null
          event_id: string
          event_name: string
          event_name_heb?: string | null
          event_status: string
          hometeam_id?: string | null
          hometeam_name?: string | null
          is_popular?: boolean | null
          iso_country?: string | null
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          max_ticket_price_eur?: number | null
          min_ticket_price_eur?: number | null
          number_of_tickets?: number | null
          sales_periods?: Json | null
          season?: string | null
          slug?: string | null
          sport_type?: string | null
          tournament_id: string
          tournament_name: string
          tournament_name_heb?: string | null
          tournament_type?: string | null
          updated?: string | null
          updated_at?: string | null
          venue_id: string
          venue_name: string
          venue_name_heb?: string | null
          visiting_id?: string | null
          visiting_name?: string | null
        }
        Update: {
          city?: string | null
          created?: string | null
          created_at?: string | null
          date_confirmed?: boolean | null
          date_start?: string
          date_start_main_event?: string | null
          date_stop?: string
          date_stop_main_event?: string | null
          event_description?: string | null
          event_description_heb?: string | null
          event_id?: string
          event_name?: string
          event_name_heb?: string | null
          event_status?: string
          hometeam_id?: string | null
          hometeam_name?: string | null
          is_popular?: boolean | null
          iso_country?: string | null
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          max_ticket_price_eur?: number | null
          min_ticket_price_eur?: number | null
          number_of_tickets?: number | null
          sales_periods?: Json | null
          season?: string | null
          slug?: string | null
          sport_type?: string | null
          tournament_id?: string
          tournament_name?: string
          tournament_name_heb?: string | null
          tournament_type?: string | null
          updated?: string | null
          updated_at?: string | null
          venue_id?: string
          venue_name?: string
          venue_name_heb?: string | null
          visiting_id?: string | null
          visiting_name?: string | null
        }
        Relationships: []
      }
      xs2e_sports: {
        Row: {
          created_at: string | null
          sport_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          sport_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          sport_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      xs2e_tournaments: {
        Row: {
          created: string | null
          created_at: string | null
          date_start: string
          date_stop: string
          number_events: number | null
          official_name: string
          region: string
          season: string
          slug: string | null
          sport_type: string
          tournament_id: string
          tournament_type: string
          updated: string | null
          updated_at: string | null
        }
        Insert: {
          created?: string | null
          created_at?: string | null
          date_start: string
          date_stop: string
          number_events?: number | null
          official_name: string
          region: string
          season: string
          slug?: string | null
          sport_type: string
          tournament_id: string
          tournament_type: string
          updated?: string | null
          updated_at?: string | null
        }
        Update: {
          created?: string | null
          created_at?: string | null
          date_start?: string
          date_stop?: string
          number_events?: number | null
          official_name?: string
          region?: string
          season?: string
          slug?: string | null
          sport_type?: string
          tournament_id?: string
          tournament_type?: string
          updated?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      event_category_links: {
        Row: {
          category_id: number | null
          event_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "category_tags_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tag_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_event_consumed: {
        Row: {
          consumed_seats: number | null
          event_id: number | null
          flight_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_offline_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      partner_clicked_events: {
        Args: { p_limit?: number; p_tracking_code: string }
        Returns: {
          clicks: number
          event_date: string
          event_location: string
          event_name: string
          visitors: number
        }[]
      }
      partner_clicked_events_range: {
        Args: {
          p_from?: string
          p_limit?: number
          p_to?: string
          p_tracking_code: string
        }
        Returns: {
          clicks: number
          event_date: string
          event_location: string
          event_name: string
          visitors: number
        }[]
      }
      partner_coupon_usage: {
        Args: { p_codes: string[] }
        Returns: {
          code: string
          paid_uses: number
          used_usd: number
        }[]
      }
      partner_entry_funnels_range: {
        Args: { p_from?: string; p_to?: string; p_tracking_code: string }
        Returns: {
          entry: string
          stage: string
          visitors: number
        }[]
      }
      partner_funnel_counts: {
        Args: { p_tracking_code: string }
        Returns: {
          stage: string
          visitors: number
        }[]
      }
      partner_funnel_counts_range: {
        Args: { p_from?: string; p_to?: string; p_tracking_code: string }
        Returns: {
          stage: string
          visitors: number
        }[]
      }
      partners_clicked_event_partners_all: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          affiliate_id: string
          clicks: number
          event_date: string
          event_location: string
          event_name: string
          visitors: number
        }[]
      }
      partners_clicked_events_all: {
        Args: { p_from?: string; p_limit?: number; p_to?: string }
        Returns: {
          clicks: number
          event_date: string
          event_location: string
          event_name: string
          partners: number
          visitors: number
        }[]
      }
      partners_entry_funnels_all: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          entry: string
          stage: string
          visitors: number
        }[]
      }
      partners_funnel_counts_all: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          stage: string
          visitors: number
        }[]
      }
      partners_visitors_by_code: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          affiliate_id: string
          visitors: number
        }[]
      }
      tracking_code_is_real_partner: {
        Args: { p_code: string }
        Returns: boolean
      }
    }
    Enums: {
      price: "NUMERIC(10, 2)"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      price: ["NUMERIC(10, 2)"],
    },
  },
} as const
