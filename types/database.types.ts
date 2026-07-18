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
          slug?: string
          sport?: string | null
          subtitle?: string | null
          tag?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          event_id: number | null
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
          discount_type: string
          discount_value: number
          event_id?: number | null
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
          discount_type?: string
          discount_value?: number
          event_id?: number | null
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
          location: Json | null
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
          location?: Json | null
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
          location?: Json | null
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
        Relationships: []
      }
      flights: {
        Row: {
          airline_code: string
          consumed_quantity: number
          duration: string
          event_ids: number[]
          id: number
          inbound_arrival_airport: string
          inbound_arrival_time: string
          inbound_cabin_bags_included: boolean
          inbound_check_bags_included: boolean
          inbound_departure_airport: string
          inbound_departure_time: string
          inbound_duration: string
          inbound_flight_number: string
          initial_quantity: number
          is_deleted: boolean
          metadata_iata: string
          metadata_logo: string
          metadata_name: string
          outbound_arrival_airport: string
          outbound_arrival_time: string
          outbound_cabin_bags_included: boolean
          outbound_check_bags_included: boolean
          outbound_departure_airport: string
          outbound_departure_time: string
          outbound_duration: string
          outbound_flight_number: string
          price: number
          stops: number
        }
        Insert: {
          airline_code: string
          consumed_quantity?: number
          duration: string
          event_ids?: number[]
          id?: number
          inbound_arrival_airport: string
          inbound_arrival_time: string
          inbound_cabin_bags_included: boolean
          inbound_check_bags_included: boolean
          inbound_departure_airport: string
          inbound_departure_time: string
          inbound_duration: string
          inbound_flight_number: string
          initial_quantity: number
          is_deleted?: boolean
          metadata_iata: string
          metadata_logo: string
          metadata_name: string
          outbound_arrival_airport: string
          outbound_arrival_time: string
          outbound_cabin_bags_included: boolean
          outbound_check_bags_included: boolean
          outbound_departure_airport: string
          outbound_departure_time: string
          outbound_duration: string
          outbound_flight_number: string
          price: number
          stops: number
        }
        Update: {
          airline_code?: string
          consumed_quantity?: number
          duration?: string
          event_ids?: number[]
          id?: number
          inbound_arrival_airport?: string
          inbound_arrival_time?: string
          inbound_cabin_bags_included?: boolean
          inbound_check_bags_included?: boolean
          inbound_departure_airport?: string
          inbound_departure_time?: string
          inbound_duration?: string
          inbound_flight_number?: string
          initial_quantity?: number
          is_deleted?: boolean
          metadata_iata?: string
          metadata_logo?: string
          metadata_name?: string
          outbound_arrival_airport?: string
          outbound_arrival_time?: string
          outbound_cabin_bags_included?: boolean
          outbound_check_bags_included?: boolean
          outbound_departure_airport?: string
          outbound_departure_time?: string
          outbound_duration?: string
          outbound_flight_number?: string
          price?: number
          stops?: number
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
      partners: {
        Row: {
          commission: number
          created_at: string
          email: string
          is_active: boolean
          name_hebrew: string | null
          partner_tracking_code: string
          password: string
          supplier_number: number | null
          type: string | null
          user_discount: number
        }
        Insert: {
          commission?: number
          created_at: string
          email: string
          is_active?: boolean
          name_hebrew?: string | null
          partner_tracking_code: string
          password: string
          supplier_number?: number | null
          type?: string | null
          user_discount?: number
        }
        Update: {
          commission?: number
          created_at?: string
          email?: string
          is_active?: boolean
          name_hebrew?: string | null
          partner_tracking_code?: string
          password?: string
          supplier_number?: number | null
          type?: string | null
          user_discount?: number
        }
        Relationships: []
      }
      reservations: {
        Row: {
          accounting_number: number | null
          aff_partner_tracking_code: string | null
          booking_reference: string | null
          comments: string | null
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
          payment_info: Json | null
          status: string
          user_shown_price: number
        }
        Insert: {
          accounting_number?: number | null
          aff_partner_tracking_code?: string | null
          booking_reference?: string | null
          comments?: string | null
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
          payment_info?: Json | null
          status?: string
          user_shown_price: number
        }
        Update: {
          accounting_number?: number | null
          aff_partner_tracking_code?: string | null
          booking_reference?: string | null
          comments?: string | null
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
          payment_info?: Json | null
          status?: string
          user_shown_price?: number
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
          updated_at?: string | null
          venue_data?: Json | null
          venue_map_url?: string | null
          venue_name?: string | null
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
