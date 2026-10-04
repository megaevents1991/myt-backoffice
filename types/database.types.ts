export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  c_megafamily: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      cars: {
        Row: {
          code: string | null
          company_id: string | null
          content_html: string | null
          data: Json | null
          id: string | null
          image: string | null
          legacy_id: number | null
          max_people: number | null
          name: string | null
          position: number | null
          slug: string | null
        }
        Insert: {
          code?: string | null
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          id?: string | null
          image?: string | null
          legacy_id?: number | null
          max_people?: number | null
          name?: string | null
          position?: number | null
          slug?: string | null
        }
        Update: {
          code?: string | null
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          id?: string | null
          image?: string | null
          legacy_id?: number | null
          max_people?: number | null
          name?: string | null
          position?: number | null
          slug?: string | null
        }
        Relationships: []
      }
      cms_pages: {
        Row: {
          blocks: Json | null
          company_id: string | null
          content_html: string | null
          data: Json | null
          id: string | null
          is_active: boolean | null
          kind: string | null
          legacy_id: number | null
          path: string | null
          position: number | null
          seo: Json | null
          title: string | null
        }
        Insert: {
          blocks?: Json | null
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          id?: string | null
          is_active?: boolean | null
          kind?: string | null
          legacy_id?: number | null
          path?: string | null
          position?: number | null
          seo?: Json | null
          title?: string | null
        }
        Update: {
          blocks?: Json | null
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          id?: string | null
          is_active?: boolean | null
          kind?: string | null
          legacy_id?: number | null
          path?: string | null
          position?: number | null
          seo?: Json | null
          title?: string | null
        }
        Relationships: []
      }
      departure_flights: {
        Row: {
          airline_code: string | null
          block_status: string | null
          departure_id: string | null
          flight_id: number | null
          inbound_airline_code: string | null
          inbound_arrival_airport: string | null
          inbound_arrival_time: string | null
          inbound_check_bags_included: boolean | null
          inbound_departure_airport: string | null
          inbound_departure_time: string | null
          inbound_flight_number: string | null
          inbound_stop_airport: string | null
          inbound_stop_duration: string | null
          legs: string | null
          metadata_logo: string | null
          metadata_name: string | null
          outbound_arrival_airport: string | null
          outbound_arrival_time: string | null
          outbound_check_bags_included: boolean | null
          outbound_departure_airport: string | null
          outbound_departure_time: string | null
          outbound_flight_number: string | null
          outbound_stop_airport: string | null
          outbound_stop_duration: string | null
          stops: number | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_allocations_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      departure_options: {
        Row: {
          board: string | null
          departure_id: string | null
          id: string | null
          kind: string | null
          label: string | null
          max_people: number | null
          nights: number | null
          position: number | null
          price: number | null
          price_unit: string | null
          ref_code: string | null
          room_prices: Json | null
          stay_order: number | null
        }
        Relationships: [
          {
            foreignKeyName: "departure_options_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      departure_prices: {
        Row: {
          departure_id: string | null
          pax_type: string | null
          price: number | null
          room_position: number | null
        }
        Relationships: [
          {
            foreignKeyName: "departure_prices_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      departures: {
        Row: {
          arrival_airport: string | null
          baggage_included: boolean | null
          card_badge: string | null
          child_max_age: number | null
          code: string | null
          connection_back: string | null
          connection_out: string | null
          currency: string | null
          data: Json | null
          date_labels: string[] | null
          end_date: string | null
          flight_mode: string | null
          flight_price: number | null
          id: string | null
          itinerary_id: string | null
          legacy_product_id: number | null
          markup_fixed: number | null
          markup_percent: number | null
          meal_included: boolean | null
          meeting_at: string | null
          package_id: string | null
          return_airport: string | null
          sale_status: string | null
          season: string | null
          season_year: number | null
          senior_discount: number | null
          senior_min_age: number | null
          series_id: string | null
          site_id: number | null
          start_date: string | null
          transfers_included: boolean | null
        }
        Insert: {
          arrival_airport?: string | null
          baggage_included?: boolean | null
          card_badge?: string | null
          child_max_age?: number | null
          code?: string | null
          connection_back?: string | null
          connection_out?: string | null
          currency?: string | null
          data?: Json | null
          date_labels?: string[] | null
          end_date?: string | null
          flight_mode?: string | null
          flight_price?: number | null
          id?: string | null
          itinerary_id?: string | null
          legacy_product_id?: number | null
          markup_fixed?: number | null
          markup_percent?: number | null
          meal_included?: boolean | null
          meeting_at?: string | null
          package_id?: string | null
          return_airport?: string | null
          sale_status?: string | null
          season?: string | null
          season_year?: number | null
          senior_discount?: number | null
          senior_min_age?: number | null
          series_id?: string | null
          site_id?: number | null
          start_date?: string | null
          transfers_included?: boolean | null
        }
        Update: {
          arrival_airport?: string | null
          baggage_included?: boolean | null
          card_badge?: string | null
          child_max_age?: number | null
          code?: string | null
          connection_back?: string | null
          connection_out?: string | null
          currency?: string | null
          data?: Json | null
          date_labels?: string[] | null
          end_date?: string | null
          flight_mode?: string | null
          flight_price?: number | null
          id?: string | null
          itinerary_id?: string | null
          legacy_product_id?: number | null
          markup_fixed?: number | null
          markup_percent?: number | null
          meal_included?: boolean | null
          meeting_at?: string | null
          package_id?: string | null
          return_airport?: string | null
          sale_status?: string | null
          season?: string | null
          season_year?: number | null
          senior_discount?: number | null
          senior_min_age?: number | null
          series_id?: string | null
          site_id?: number | null
          start_date?: string | null
          transfers_included?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "departures_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "package_itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departures_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departures_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          amenities: string[] | null
          city: string | null
          code: string | null
          company_id: string | null
          content_html: string | null
          data: Json | null
          excerpt: string | null
          gallery: Json | null
          id: string | null
          image: string | null
          legacy_id: number | null
          name: string | null
          position: number | null
          slug: string | null
          stars: number | null
        }
        Insert: {
          amenities?: string[] | null
          city?: string | null
          code?: string | null
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          excerpt?: string | null
          gallery?: Json | null
          id?: string | null
          image?: string | null
          legacy_id?: number | null
          name?: string | null
          position?: number | null
          slug?: string | null
          stars?: number | null
        }
        Update: {
          amenities?: string[] | null
          city?: string | null
          code?: string | null
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          excerpt?: string | null
          gallery?: Json | null
          id?: string | null
          image?: string | null
          legacy_id?: number | null
          name?: string | null
          position?: number | null
          slug?: string | null
          stars?: number | null
        }
        Relationships: []
      }
      instructors: {
        Row: {
          company_id: string | null
          content_html: string | null
          data: Json | null
          excerpt: string | null
          gallery: Json | null
          id: string | null
          image: string | null
          is_active: boolean | null
          legacy_id: number | null
          name: string | null
          position: number | null
          regions: string | null
          slug: string | null
        }
        Insert: {
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          excerpt?: string | null
          gallery?: Json | null
          id?: string | null
          image?: string | null
          is_active?: boolean | null
          legacy_id?: number | null
          name?: string | null
          position?: number | null
          regions?: string | null
          slug?: string | null
        }
        Update: {
          company_id?: string | null
          content_html?: string | null
          data?: Json | null
          excerpt?: string | null
          gallery?: Json | null
          id?: string | null
          image?: string | null
          is_active?: boolean | null
          legacy_id?: number | null
          name?: string | null
          position?: number | null
          regions?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      package_itineraries: {
        Row: {
          arrival_city: string | null
          company_id: string | null
          days: Json | null
          id: string | null
          key: string | null
          label: string | null
          package_id: string | null
          return_city: string | null
        }
        Insert: {
          arrival_city?: string | null
          company_id?: string | null
          days?: Json | null
          id?: string | null
          key?: string | null
          label?: string | null
          package_id?: string | null
          return_city?: string | null
        }
        Update: {
          arrival_city?: string | null
          company_id?: string | null
          days?: Json | null
          id?: string | null
          key?: string | null
          label?: string | null
          package_id?: string | null
          return_city?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_itineraries_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_terms: {
        Row: {
          package_id: string | null
          term_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_terms_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_terms_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          attractions: string[] | null
          brand: string | null
          cancellation_html: string | null
          card_image: string | null
          company_id: string | null
          countries: string | null
          created_at: string | null
          data: Json | null
          days: number | null
          description_html: string | null
          extra_info_html: string | null
          extra_sections: Json | null
          faq: Json | null
          gallery: string[] | null
          hero_image: string | null
          hotels: Json | null
          id: string | null
          instructor_ids: string[] | null
          included: string[] | null
          is_active: boolean | null
          is_deleted: string | null
          kind: string | null
          legacy_id: number | null
          name: string | null
          nights: number | null
          not_included: string[] | null
          seasons: string[] | null
          seo: Json | null
          slug: string | null
          subtitle: string | null
          terms_html: string | null
          updated_at: string | null
        }
        Insert: {
          attractions?: string[] | null
          brand?: string | null
          cancellation_html?: string | null
          card_image?: string | null
          company_id?: string | null
          countries?: string | null
          created_at?: string | null
          data?: Json | null
          days?: number | null
          description_html?: string | null
          extra_info_html?: string | null
          extra_sections?: Json | null
          faq?: Json | null
          gallery?: string[] | null
          hero_image?: string | null
          hotels?: Json | null
          id?: string | null
          instructor_ids?: string[]
          included?: string[] | null
          is_active?: boolean | null
          is_deleted?: string | null
          kind?: string | null
          legacy_id?: number | null
          name?: string | null
          nights?: number | null
          not_included?: string[] | null
          seasons?: string[] | null
          seo?: Json | null
          slug?: string | null
          subtitle?: string | null
          terms_html?: string | null
          updated_at?: string | null
        }
        Update: {
          attractions?: string[] | null
          brand?: string | null
          cancellation_html?: string | null
          card_image?: string | null
          company_id?: string | null
          countries?: string | null
          created_at?: string | null
          data?: Json | null
          days?: number | null
          description_html?: string | null
          extra_info_html?: string | null
          extra_sections?: Json | null
          faq?: Json | null
          gallery?: string[] | null
          hero_image?: string | null
          hotels?: Json | null
          id?: string | null
          instructor_ids?: string[]
          included?: string[] | null
          is_active?: boolean | null
          is_deleted?: string | null
          kind?: string | null
          legacy_id?: number | null
          name?: string | null
          nights?: number | null
          not_included?: string[] | null
          seasons?: string[] | null
          seo?: Json | null
          slug?: string | null
          subtitle?: string | null
          terms_html?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promotions: {
        Row: {
          departure_id: string | null
          id: string | null
          kind: string | null
          label: string | null
          series_id: string | null
          show_on_card: boolean | null
          valid_until: string | null
          value: number | null
        }
        Insert: {
          departure_id?: string | null
          id?: string | null
          kind?: string | null
          label?: string | null
          series_id?: string | null
          show_on_card?: boolean | null
          valid_until?: string | null
          value?: number | null
        }
        Update: {
          departure_id?: string | null
          id?: string | null
          kind?: string | null
          label?: string | null
          series_id?: string | null
          show_on_card?: boolean | null
          valid_until?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      series: {
        Row: {
          arrival_airport: string | null
          arrival_weekday: number | null
          child_max_age: number | null
          code: string | null
          company_id: string | null
          default_capacity: number | null
          default_currency: string | null
          default_nights: number | null
          id: string | null
          is_active: boolean | null
          label: string | null
          package_id: string | null
          return_airport: string | null
          return_weekday: number | null
          senior_discount: number | null
          senior_min_age: number | null
        }
        Insert: {
          arrival_airport?: string | null
          arrival_weekday?: number | null
          child_max_age?: number | null
          code?: string | null
          company_id?: string | null
          default_capacity?: number | null
          default_currency?: string | null
          default_nights?: number | null
          id?: string | null
          is_active?: boolean | null
          label?: string | null
          package_id?: string | null
          return_airport?: string | null
          return_weekday?: number | null
          senior_discount?: number | null
          senior_min_age?: number | null
        }
        Update: {
          arrival_airport?: string | null
          arrival_weekday?: number | null
          child_max_age?: number | null
          code?: string | null
          company_id?: string | null
          default_capacity?: number | null
          default_currency?: string | null
          default_nights?: number | null
          id?: string | null
          is_active?: boolean | null
          label?: string | null
          package_id?: string | null
          return_airport?: string | null
          return_weekday?: number | null
          senior_discount?: number | null
          senior_min_age?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "series_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      series_terms: {
        Row: {
          series_id: string | null
          term_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "series_terms_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_terms_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          company_id: string | null
          data: Json | null
          description_html: string | null
          hero_images: string[] | null
          id: string | null
          is_active: boolean | null
          kind: string | null
          legacy_id: number | null
          name: string | null
          position: number | null
          slug: string | null
        }
        Insert: {
          company_id?: string | null
          data?: Json | null
          description_html?: string | null
          hero_images?: string[] | null
          id?: string | null
          is_active?: boolean | null
          kind?: string | null
          legacy_id?: number | null
          name?: string | null
          position?: number | null
          slug?: string | null
        }
        Update: {
          company_id?: string | null
          data?: Json | null
          description_html?: string | null
          hero_images?: string[] | null
          id?: string | null
          is_active?: boolean | null
          kind?: string | null
          legacy_id?: number | null
          name?: string | null
          position?: number | null
          slug?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      submit_lead: {
        Args: {
          p_email: string
          p_kind: string
          p_message: string
          p_name: string
          p_payload?: Json
          p_phone: string
          p_source_path?: string
          p_utm?: Json
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
      agent_instructions: {
        Row: {
          active: boolean
          agent_key: string
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          id: string
          text: string
        }
        Insert: {
          active?: boolean
          agent_key: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          id?: string
          text: string
        }
        Update: {
          active?: boolean
          agent_key?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          id?: string
          text?: string
        }
        Relationships: []
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
          event_gallery: Json
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
          event_gallery?: Json
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
          event_gallery?: Json
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
      base_price_sync_log: {
        Row: {
          component: string
          created_at: string
          event_id: number
          id: number
          live_price: number | null
          new_price: number | null
          note: string | null
          old_price: number | null
          status: string
        }
        Insert: {
          component: string
          created_at?: string
          event_id: number
          id?: never
          live_price?: number | null
          new_price?: number | null
          note?: string | null
          old_price?: number | null
          status?: string
        }
        Update: {
          component?: string
          created_at?: string
          event_id?: number
          id?: never
          live_price?: number | null
          new_price?: number | null
          note?: string | null
          old_price?: number | null
          status?: string
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
      calendar_periods: {
        Row: {
          company_id: string | null
          end_date: string | null
          holiday_date: string | null
          id: string
          kind: string
          name: string
          note: string | null
          start_date: string | null
          year: number
        }
        Insert: {
          company_id?: string | null
          end_date?: string | null
          holiday_date?: string | null
          id?: string
          kind?: string
          name: string
          note?: string | null
          start_date?: string | null
          year: number
        }
        Update: {
          company_id?: string | null
          end_date?: string | null
          holiday_date?: string | null
          id?: string
          kind?: string
          name?: string
          note?: string | null
          start_date?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "calendar_periods_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_requests: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: number
          id_number: string
          last_name: string
          note: string | null
          order_number: string
          phone: string
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          email: string
          first_name: string
          id?: number
          id_number: string
          last_name: string
          note?: string | null
          order_number: string
          phone: string
          source?: string
          status?: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: number
          id_number?: string
          last_name?: string
          note?: string | null
          order_number?: string
          phone?: string
          source?: string
          status?: string
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
      companies: {
        Row: {
          analytics: Json
          brand: Json
          contact: Json
          created_at: string
          default_currency: string
          email_config: Json
          features: Json
          id: string
          is_active: boolean
          legal_name: string | null
          locale: string
          name: string
          payment_config: Json
          product_types: string[]
          revalidate_url: string | null
          schema_name: string
          site_url: string | null
          slug: string
        }
        Insert: {
          analytics?: Json
          brand?: Json
          contact?: Json
          created_at?: string
          default_currency?: string
          email_config?: Json
          features?: Json
          id?: string
          is_active?: boolean
          legal_name?: string | null
          locale?: string
          name: string
          payment_config?: Json
          product_types?: string[]
          revalidate_url?: string | null
          schema_name: string
          site_url?: string | null
          slug: string
        }
        Update: {
          analytics?: Json
          brand?: Json
          contact?: Json
          created_at?: string
          default_currency?: string
          email_config?: Json
          features?: Json
          id?: string
          is_active?: boolean
          legal_name?: string | null
          locale?: string
          name?: string
          payment_config?: Json
          product_types?: string[]
          revalidate_url?: string | null
          schema_name?: string
          site_url?: string | null
          slug?: string
        }
        Relationships: []
      }
      company_domains: {
        Row: {
          company_id: string
          domain: string
          is_primary: boolean
        }
        Insert: {
          company_id: string
          domain: string
          is_primary?: boolean
        }
        Update: {
          company_id?: string
          domain?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "company_domains_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_exchange_rates: {
        Row: {
          company_id: string
          created_at: string
          currency: string
          entered_by: string | null
          rate_date: string
          rate_to_ils: number
        }
        Insert: {
          company_id: string
          created_at?: string
          currency: string
          entered_by?: string | null
          rate_date: string
          rate_to_ils: number
        }
        Update: {
          company_id?: string
          created_at?: string
          currency?: string
          entered_by?: string | null
          rate_date?: string
          rate_to_ils?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_exchange_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          role: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_crawl_runs: {
        Row: {
          browser_mode: string | null
          competitor: string
          finished_at: string | null
          id: number
          listings: number
          note: string | null
          pages: number
          prev_listings: number | null
          started_at: string
          status: string
          trigger: string
        }
        Insert: {
          browser_mode?: string | null
          competitor: string
          finished_at?: string | null
          id?: number
          listings?: number
          note?: string | null
          pages?: number
          prev_listings?: number | null
          started_at?: string
          status: string
          trigger: string
        }
        Update: {
          browser_mode?: string | null
          competitor?: string
          finished_at?: string | null
          id?: number
          listings?: number
          note?: string | null
          pages?: number
          prev_listings?: number | null
          started_at?: string
          status?: string
          trigger?: string
        }
        Relationships: []
      }
      competitor_listing_corrections: {
        Row: {
          competitor: string
          created_at: string
          created_by: string | null
          event_id: number | null
          field: string
          id: number
          listing_id: number
          note: string
          original: Json | null
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          source: string | null
          value: Json | null
        }
        Insert: {
          competitor: string
          created_at?: string
          created_by?: string | null
          event_id?: number | null
          field: string
          id?: never
          listing_id: number
          note: string
          original?: Json | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string | null
          value?: Json | null
        }
        Update: {
          competitor?: string
          created_at?: string
          created_by?: string | null
          event_id?: number | null
          field?: string
          id?: never
          listing_id?: number
          note?: string
          original?: Json | null
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          source?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_listing_corrections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_listing_corrections_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "competitor_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_listings: {
        Row: {
          attrs: Json | null
          city: string | null
          competitor: string
          currency: string | null
          detail_text: string | null
          event_date: string | null
          external_key: string
          first_seen_at: string
          id: number
          last_changed_at: string
          last_seen_at: string
          price_from: number | null
          price_usd: number | null
          run_id: number | null
          scope: string
          title: string
          title_he: string | null
          travel_depart: string | null
          travel_return: string | null
          url: string
          venue: string | null
        }
        Insert: {
          attrs?: Json | null
          city?: string | null
          competitor: string
          currency?: string | null
          detail_text?: string | null
          event_date?: string | null
          external_key: string
          first_seen_at?: string
          id?: number
          last_changed_at?: string
          last_seen_at?: string
          price_from?: number | null
          price_usd?: number | null
          run_id?: number | null
          scope: string
          title: string
          title_he?: string | null
          travel_depart?: string | null
          travel_return?: string | null
          url: string
          venue?: string | null
        }
        Update: {
          attrs?: Json | null
          city?: string | null
          competitor?: string
          currency?: string | null
          detail_text?: string | null
          event_date?: string | null
          external_key?: string
          first_seen_at?: string
          id?: number
          last_changed_at?: string
          last_seen_at?: string
          price_from?: number | null
          price_usd?: number | null
          run_id?: number | null
          scope?: string
          title?: string
          title_he?: string | null
          travel_depart?: string | null
          travel_return?: string | null
          url?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_listings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "competitor_crawl_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_matches: {
        Row: {
          adjustments: Json | null
          ai_verdict: Json | null
          attrs: Json | null
          competitor: string
          created_at: string
          diff_usd: number | null
          event_id: number
          id: number
          light: string | null
          listing_changed_at: string | null
          listing_id: number | null
          method: string
          normalized_usd: number | null
          note: string | null
          our_usd: number | null
          price_usd: number | null
          raw_currency: string | null
          raw_price: number | null
          scope: string
          status: string
        }
        Insert: {
          adjustments?: Json | null
          ai_verdict?: Json | null
          attrs?: Json | null
          competitor: string
          created_at?: string
          diff_usd?: number | null
          event_id: number
          id?: number
          light?: string | null
          listing_changed_at?: string | null
          listing_id?: number | null
          method: string
          normalized_usd?: number | null
          note?: string | null
          our_usd?: number | null
          price_usd?: number | null
          raw_currency?: string | null
          raw_price?: number | null
          scope: string
          status: string
        }
        Update: {
          adjustments?: Json | null
          ai_verdict?: Json | null
          attrs?: Json | null
          competitor?: string
          created_at?: string
          diff_usd?: number | null
          event_id?: number
          id?: number
          light?: string | null
          listing_changed_at?: string | null
          listing_id?: number | null
          method?: string
          normalized_usd?: number | null
          note?: string | null
          our_usd?: number | null
          price_usd?: number | null
          raw_currency?: string | null
          raw_price?: number | null
          scope?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "competitor_listings"
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
          influencer_partner_code: string | null
          is_active: boolean
          max_uses: number | null
          partner_tracking_code: string | null
          per_person: boolean
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
          influencer_partner_code?: string | null
          is_active?: boolean
          max_uses?: number | null
          partner_tracking_code?: string | null
          per_person?: boolean
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
          influencer_partner_code?: string | null
          is_active?: boolean
          max_uses?: number | null
          partner_tracking_code?: string | null
          per_person?: boolean
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
      creative_gap_dismissals: {
        Row: {
          created_at: string
          dismissed_by: string | null
          gap_key: string
          kind: string
          label: string | null
          note: string | null
          row_id: string
          source_table: string
        }
        Insert: {
          created_at?: string
          dismissed_by?: string | null
          gap_key: string
          kind: string
          label?: string | null
          note?: string | null
          row_id: string
          source_table: string
        }
        Update: {
          created_at?: string
          dismissed_by?: string | null
          gap_key?: string
          kind?: string
          label?: string | null
          note?: string | null
          row_id?: string
          source_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_gap_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
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
      event_drafts: {
        Row: {
          created_at: string
          created_by: string | null
          created_event_id: number | null
          error: string | null
          id: string
          missing: Json
          payload: Json
          scope: Json
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_event_id?: number | null
          error?: string | null
          id?: string
          missing?: Json
          payload: Json
          scope?: Json
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_event_id?: number | null
          error?: string | null
          id?: string
          missing?: Json
          payload?: Json
          scope?: Json
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      event_price_snapshots: {
        Row: {
          base_flight: number | null
          base_hotel: number | null
          day: string
          event_id: number
          markup: number | null
          min_ticket: number | null
          package_usd: number | null
          ticket_usd: number | null
        }
        Insert: {
          base_flight?: number | null
          base_hotel?: number | null
          day: string
          event_id: number
          markup?: number | null
          min_ticket?: number | null
          package_usd?: number | null
          ticket_usd?: number | null
        }
        Update: {
          base_flight?: number | null
          base_hotel?: number | null
          day?: string
          event_id?: number
          markup?: number | null
          min_ticket?: number | null
          package_usd?: number | null
          ticket_usd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_price_snapshots_event_id_fkey"
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
          event_location: Json | null
          id: number
          is_deleted: string | null
          is_prioritized: boolean | null
          is_test: boolean
          light_checked_at: string | null
          light_detail: Json | null
          light_package: string | null
          light_red_since: string | null
          light_silenced_until: string | null
          light_ticket: string | null
          location: Json | null
          locked_flight_id: number | null
          lodging_default: string
          lodging_mode: string
          lodging_note: string | null
          map_image_url: string | null
          markup_flight: number | null
          markup_hotel: number | null
          markup_ticket: number | null
          name: string
          name_english: string | null
          package_mode: string
          price_drop_from: number | null
          price_drop_until: string | null
          price_drop_usd: number | null
          ready_package_mode: string | null
          ready_package_price_usd: number | null
          ready_package_token: string | null
          skip_flight: boolean | null
          skip_flight_markup: number | null
          skip_hotel_markup: number | null
          split_default_nights: number
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
          event_location?: Json | null
          id?: number
          is_deleted?: string | null
          is_prioritized?: boolean | null
          is_test?: boolean
          light_checked_at?: string | null
          light_detail?: Json | null
          light_package?: string | null
          light_red_since?: string | null
          light_silenced_until?: string | null
          light_ticket?: string | null
          location?: Json | null
          locked_flight_id?: number | null
          lodging_default?: string
          lodging_mode?: string
          lodging_note?: string | null
          map_image_url?: string | null
          markup_flight?: number | null
          markup_hotel?: number | null
          markup_ticket?: number | null
          name: string
          name_english?: string | null
          package_mode?: string
          price_drop_from?: number | null
          price_drop_until?: string | null
          price_drop_usd?: number | null
          ready_package_mode?: string | null
          ready_package_price_usd?: number | null
          ready_package_token?: string | null
          skip_flight?: boolean | null
          skip_flight_markup?: number | null
          skip_hotel_markup?: number | null
          split_default_nights?: number
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
          event_location?: Json | null
          id?: number
          is_deleted?: string | null
          is_prioritized?: boolean | null
          is_test?: boolean
          light_checked_at?: string | null
          light_detail?: Json | null
          light_package?: string | null
          light_red_since?: string | null
          light_silenced_until?: string | null
          light_ticket?: string | null
          location?: Json | null
          locked_flight_id?: number | null
          lodging_default?: string
          lodging_mode?: string
          lodging_note?: string | null
          map_image_url?: string | null
          markup_flight?: number | null
          markup_hotel?: number | null
          markup_ticket?: number | null
          name?: string
          name_english?: string | null
          package_mode?: string
          price_drop_from?: number | null
          price_drop_until?: string | null
          price_drop_usd?: number | null
          ready_package_mode?: string | null
          ready_package_price_usd?: number | null
          ready_package_token?: string | null
          skip_flight?: boolean | null
          skip_flight_markup?: number | null
          skip_hotel_markup?: number | null
          split_default_nights?: number
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
      flight_block_events: {
        Row: {
          amount: number | null
          created_at: string
          created_by: string | null
          currency: string | null
          flight_id: number
          happened_on: string
          id: string
          kind: string
          note: string | null
          seats_after: number | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          flight_id: number
          happened_on?: string
          id?: string
          kind: string
          note?: string | null
          seats_after?: number | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          flight_id?: number
          happened_on?: string
          id?: string
          kind?: string
          note?: string | null
          seats_after?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_block_events_flight_id_fkey"
            columns: ["flight_id"]
            isOneToOne: false
            referencedRelation: "flights"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_contract_rules: {
        Row: {
          contract_id: string
          days_before_from: number
          days_before_to: number
          deposit_per_pax: number | null
          fee_kind: string | null
          fee_value: number | null
          free_reduction_pct: number
          id: string
          note: string | null
        }
        Insert: {
          contract_id: string
          days_before_from: number
          days_before_to: number
          deposit_per_pax?: number | null
          fee_kind?: string | null
          fee_value?: number | null
          free_reduction_pct?: number
          id?: string
          note?: string | null
        }
        Update: {
          contract_id?: string
          days_before_from?: number
          days_before_to?: number
          deposit_per_pax?: number | null
          fee_kind?: string | null
          fee_value?: number | null
          free_reduction_pct?: number
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_contract_rules_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "flight_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_contracts: {
        Row: {
          airline_group: string | null
          commitment_amount: number | null
          commitment_unit: string | null
          company_id: string
          created_at: string
          currency: string
          cxx1_days_before: number
          cxx2_days_before: number
          id: string
          is_active: boolean
          kind: string
          name: string
          name_change_fee: number | null
          names_days_before: number | null
          terms_text: string | null
          ticketing_days_before: number | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          airline_group?: string | null
          commitment_amount?: number | null
          commitment_unit?: string | null
          company_id: string
          created_at?: string
          currency?: string
          cxx1_days_before?: number
          cxx2_days_before?: number
          id?: string
          is_active?: boolean
          kind?: string
          name: string
          name_change_fee?: number | null
          names_days_before?: number | null
          terms_text?: string | null
          ticketing_days_before?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          airline_group?: string | null
          commitment_amount?: number | null
          commitment_unit?: string | null
          company_id?: string
          created_at?: string
          currency?: string
          cxx1_days_before?: number
          cxx2_days_before?: number
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          name_change_fee?: number | null
          names_days_before?: number | null
          terms_text?: string | null
          ticketing_days_before?: number | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flight_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          cancel_reason: string | null
          cancellation_fee: number | null
          cancelled_at: string | null
          checked_bag_kg: number | null
          company_id: string
          consumed_quantity: number
          contract_id: string | null
          cost_child_price: number | null
          cost_currency: string | null
          cost_price: number | null
          cost_tax: number | null
          duration: string
          event_ids: number[]
          first_cancellation_date: string | null
          group_code: string | null
          handled_by: string | null
          id: number
          import_ref: string | null
          inbound_airline_code: string | null
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
          names_deadline: string | null
          notes: string | null
          option_expiry: string | null
          original_quantity: number | null
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
          requested_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          season_label: string | null
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
          cancel_reason?: string | null
          cancellation_fee?: number | null
          cancelled_at?: string | null
          checked_bag_kg?: number | null
          company_id?: string
          consumed_quantity?: number
          contract_id?: string | null
          cost_child_price?: number | null
          cost_currency?: string | null
          cost_price?: number | null
          cost_tax?: number | null
          duration: string
          event_ids?: number[]
          first_cancellation_date?: string | null
          group_code?: string | null
          handled_by?: string | null
          id?: number
          import_ref?: string | null
          inbound_airline_code?: string | null
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
          names_deadline?: string | null
          notes?: string | null
          option_expiry?: string | null
          original_quantity?: number | null
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
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          season_label?: string | null
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
          cancel_reason?: string | null
          cancellation_fee?: number | null
          cancelled_at?: string | null
          checked_bag_kg?: number | null
          company_id?: string
          consumed_quantity?: number
          contract_id?: string | null
          cost_child_price?: number | null
          cost_currency?: string | null
          cost_price?: number | null
          cost_tax?: number | null
          duration?: string
          event_ids?: number[]
          first_cancellation_date?: string | null
          group_code?: string | null
          handled_by?: string | null
          id?: number
          import_ref?: string | null
          inbound_airline_code?: string | null
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
          names_deadline?: string | null
          notes?: string | null
          option_expiry?: string | null
          original_quantity?: number | null
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
          requested_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          season_label?: string | null
          series_id?: string | null
          series_name?: string | null
          stops?: number
          supplier?: string | null
          ticketing_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flights_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flights_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "flight_contracts"
            referencedColumns: ["id"]
          },
        ]
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
          event_gallery: Json
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
          event_gallery?: Json
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
          event_gallery?: Json
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
          is_deleted: string | null
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
          total_travelers: number | null
          trip_code_num: string | null
          trip_code_prefix: string | null
        }
        Insert: {
          created_at?: string
          event_id?: number | null
          form_id: number
          id?: never
          is_deleted?: string | null
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
          total_travelers?: number | null
          trip_code_num?: string | null
          trip_code_prefix?: string | null
        }
        Update: {
          created_at?: string
          event_id?: number | null
          form_id?: number
          id?: never
          is_deleted?: string | null
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
          total_travelers?: number | null
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
          is_deleted: string | null
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
          is_deleted?: string | null
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
          is_deleted?: string | null
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
      google_review_sources: {
        Row: {
          display_name: string | null
          maps_url: string | null
          place_id: string
          rating: number | null
          review_count: number | null
          sync_error: string | null
          synced_at: string | null
        }
        Insert: {
          display_name?: string | null
          maps_url?: string | null
          place_id: string
          rating?: number | null
          review_count?: number | null
          sync_error?: string | null
          synced_at?: string | null
        }
        Update: {
          display_name?: string | null
          maps_url?: string | null
          place_id?: string
          rating?: number | null
          review_count?: number | null
          sync_error?: string | null
          synced_at?: string | null
        }
        Relationships: []
      }
      google_reviews: {
        Row: {
          author_name: string
          author_photo_url: string | null
          author_url: string | null
          first_seen_at: string
          images: Json
          is_hidden: boolean
          language: string | null
          place_id: string
          published_at: string
          rating: number
          reply_at: string | null
          reply_text: string | null
          review_key: string
          review_url: string | null
          text: string | null
          text_html: string | null
          updated_at: string
        }
        Insert: {
          author_name: string
          author_photo_url?: string | null
          author_url?: string | null
          first_seen_at?: string
          images?: Json
          is_hidden?: boolean
          language?: string | null
          place_id: string
          published_at: string
          rating: number
          reply_at?: string | null
          reply_text?: string | null
          review_key: string
          review_url?: string | null
          text?: string | null
          text_html?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string
          author_photo_url?: string | null
          author_url?: string | null
          first_seen_at?: string
          images?: Json
          is_hidden?: boolean
          language?: string | null
          place_id?: string
          published_at?: string
          rating?: number
          reply_at?: string | null
          reply_text?: string | null
          review_key?: string
          review_url?: string | null
          text?: string | null
          text_html?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_reviews_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "google_review_sources"
            referencedColumns: ["place_id"]
          },
        ]
      }
      homepage_items: {
        Row: {
          kind: string
          position: number
          ref_id: string
          section: string
          updated_at: string
        }
        Insert: {
          kind: string
          position?: number
          ref_id: string
          section: string
          updated_at?: string
        }
        Update: {
          kind?: string
          position?: number
          ref_id?: string
          section?: string
          updated_at?: string
        }
        Relationships: []
      }
      homepage_sections: {
        Row: {
          config: Json
          is_visible: boolean
          key: string
          page: string
          position: number
          title: string | null
          type: string
          updated_at: string
        }
        Insert: {
          config?: Json
          is_visible?: boolean
          key: string
          page?: string
          position?: number
          title?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          is_visible?: boolean
          key?: string
          page?: string
          position?: number
          title?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      hotel_warm_areas: {
        Row: {
          created_at: string
          error: string | null
          existing: number
          found: number
          id: number
          latitude: number
          loaded: number
          longitude: number
          name: string | null
          radius: number
          remaining: number
          warmed_at: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          existing?: number
          found?: number
          id?: number
          latitude: number
          loaded?: number
          longitude: number
          name?: string | null
          radius?: number
          remaining?: number
          warmed_at?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          existing?: number
          found?: number
          id?: number
          latitude?: number
          loaded?: number
          longitude?: number
          name?: string | null
          radius?: number
          remaining?: number
          warmed_at?: string | null
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
      leads: {
        Row: {
          assigned_to: string | null
          company_id: string
          created_at: string
          email: string | null
          id: string
          kind: string
          message: string | null
          name: string | null
          payload: Json
          phone: string | null
          source_path: string | null
          status: string
          utm: Json
        }
        Insert: {
          assigned_to?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          id?: string
          kind: string
          message?: string | null
          name?: string | null
          payload?: Json
          phone?: string | null
          source_path?: string | null
          status?: string
          utm?: Json
        }
        Update: {
          assigned_to?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          id?: string
          kind?: string
          message?: string | null
          name?: string | null
          payload?: Json
          phone?: string | null
          source_path?: string | null
          status?: string
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "leads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
          portal_history_from: string | null
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
          portal_history_from?: string | null
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
          portal_history_from?: string | null
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
          follow_up_date: string | null
          hotel_order_info: Json | null
          hotel_skipped: boolean
          id: number
          kind: string
          max_travelers: number | null
          num_travelers: number
          partner_tracking_code: string | null
          price_adjust_per_person: number
          refresh_note: string | null
          refresh_status: string | null
          refreshed_at: string | null
          share_token: string
          spec: Json | null
          variants: Json | null
        }
        Insert: {
          allow_edit?: boolean
          created_at?: string
          created_by?: string | null
          event_id: number
          event_order_info: Json
          flight_order_info?: Json | null
          flight_skipped?: boolean
          follow_up_date?: string | null
          hotel_order_info?: Json | null
          hotel_skipped?: boolean
          id?: never
          kind?: string
          max_travelers?: number | null
          num_travelers?: number
          partner_tracking_code?: string | null
          price_adjust_per_person?: number
          refresh_note?: string | null
          refresh_status?: string | null
          refreshed_at?: string | null
          share_token: string
          spec?: Json | null
          variants?: Json | null
        }
        Update: {
          allow_edit?: boolean
          created_at?: string
          created_by?: string | null
          event_id?: number
          event_order_info?: Json
          flight_order_info?: Json | null
          flight_skipped?: boolean
          follow_up_date?: string | null
          hotel_order_info?: Json | null
          hotel_skipped?: boolean
          id?: never
          kind?: string
          max_travelers?: number | null
          num_travelers?: number
          partner_tracking_code?: string | null
          price_adjust_per_person?: number
          refresh_note?: string | null
          refresh_status?: string | null
          refreshed_at?: string | null
          share_token?: string
          spec?: Json | null
          variants?: Json | null
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
          follow_up_date: string | null
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
          follow_up_date?: string | null
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
          follow_up_date?: string | null
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
          follow_up_date: string | null
          gtmIdnts: Json | null
          hotel_order_info: Json
          hotel_segments: Json | null
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
          follow_up_date?: string | null
          gtmIdnts?: Json | null
          hotel_order_info: Json
          hotel_segments?: Json | null
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
          follow_up_date?: string | null
          gtmIdnts?: Json | null
          hotel_order_info?: Json
          hotel_segments?: Json | null
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
      task_comments: {
        Row: {
          activity: Json | null
          attachments: Json
          author_id: string | null
          body: string | null
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          kind: string
          mentions: string[]
          task_id: string
        }
        Insert: {
          activity?: Json | null
          attachments?: Json
          author_id?: string | null
          body?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          mentions?: string[]
          task_id: string
        }
        Update: {
          activity?: Json | null
          attachments?: Json
          author_id?: string | null
          body?: string | null
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          mentions?: string[]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reads: {
        Row: {
          last_read_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          last_read_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          last_read_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reads_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_rules: {
        Row: {
          active: boolean
          assignee_id: string | null
          board: string
          created_at: string
          created_by: string | null
          description: string | null
          domain: string
          dow: number
          due_days: number | null
          id: string
          last_run_at: string | null
          match: Json
          mode: string
          name: string
          priority: string
          title: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          assignee_id?: string | null
          board?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          domain: string
          dow?: number
          due_days?: number | null
          id?: string
          last_run_at?: string | null
          match?: Json
          mode?: string
          name: string
          priority?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          assignee_id?: string | null
          board?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          domain?: string
          dow?: number
          due_days?: number | null
          id?: string
          last_run_at?: string | null
          match?: Json
          mode?: string
          name?: string
          priority?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_rules_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          board: string
          channel: string | null
          company_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          parent_id: string | null
          phase: number | null
          priority: string
          progress: number | null
          reviewer_ids: string[] | null
          source: string
          source_ref: Json | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          board?: string
          channel?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          parent_id?: string | null
          phase?: number | null
          priority?: string
          progress?: number | null
          reviewer_ids?: string[] | null
          source?: string
          source_ref?: Json | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          board?: string
          channel?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          parent_id?: string | null
          phase?: number | null
          priority?: string
          progress?: number | null
          reviewer_ids?: string[] | null
          source?: string
          source_ref?: Json | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
          portal_session_id: string | null
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
          portal_session_id?: string | null
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
          portal_session_id?: string | null
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
      venue_maps: {
        Row: {
          created_at: string
          id: string
          name: string
          source_url: string
          supplier_categories: Json
          svg_url: string | null
          updated_at: string
          zones: Json
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          source_url: string
          supplier_categories?: Json
          svg_url?: string | null
          updated_at?: string
          zones?: Json
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          source_url?: string
          supplier_categories?: Json
          svg_url?: string | null
          updated_at?: string
          zones?: Json
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
      price_light_newest_matches: {
        Args: { event_ids: number[]; since: string }
        Returns: {
          created_at: string
          event_id: number
          id: number
          method: string
          scope: string
          url: string
        }[]
      }
      provision_company: { Args: { p_slug: string }; Returns: undefined }
      reprovision_all_companies: { Args: never; Returns: undefined }
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
  tours: {
    Tables: {
      bookings: {
        Row: {
          adults: number
          breakdown: Json
          cg_auth_number: string | null
          cg_card_last4: string | null
          cg_result: Json | null
          cg_tx_id: string | null
          cg_uniqueid: string | null
          children: number
          company_id: string
          confirmation_sent_at: string | null
          created_at: string
          currency: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          departure_id: string
          discount: number
          id: string
          is_deleted: string | null
          kind: string
          lead_id: string | null
          note: string | null
          paid_at: string | null
          passengers: Json
          payment_started_at: string | null
          payments: number | null
          price_basis: string
          rate: number | null
          rate_source: string | null
          receipt_no: string | null
          ref: string
          rooms: Json
          sales_entry_id: string | null
          seniors: number
          source_path: string | null
          staff_note: string | null
          status: string
          subtotal: number
          total: number
          total_ils: number | null
          updated_at: string
        }
        Insert: {
          adults?: number
          breakdown?: Json
          cg_auth_number?: string | null
          cg_card_last4?: string | null
          cg_result?: Json | null
          cg_tx_id?: string | null
          cg_uniqueid?: string | null
          children?: number
          company_id: string
          confirmation_sent_at?: string | null
          created_at?: string
          currency: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          departure_id: string
          discount?: number
          id?: string
          is_deleted?: string | null
          kind: string
          lead_id?: string | null
          note?: string | null
          paid_at?: string | null
          passengers?: Json
          payment_started_at?: string | null
          payments?: number | null
          price_basis: string
          rate?: number | null
          rate_source?: string | null
          receipt_no?: string | null
          ref: string
          rooms?: Json
          sales_entry_id?: string | null
          seniors?: number
          source_path?: string | null
          staff_note?: string | null
          status?: string
          subtotal?: number
          total?: number
          total_ils?: number | null
          updated_at?: string
        }
        Update: {
          adults?: number
          breakdown?: Json
          cg_auth_number?: string | null
          cg_card_last4?: string | null
          cg_result?: Json | null
          cg_tx_id?: string | null
          cg_uniqueid?: string | null
          children?: number
          company_id?: string
          confirmation_sent_at?: string | null
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          departure_id?: string
          discount?: number
          id?: string
          is_deleted?: string | null
          kind?: string
          lead_id?: string | null
          note?: string | null
          paid_at?: string | null
          passengers?: Json
          payment_started_at?: string | null
          payments?: number | null
          price_basis?: string
          rate?: number | null
          rate_source?: string | null
          receipt_no?: string | null
          ref?: string
          rooms?: Json
          sales_entry_id?: string | null
          seniors?: number
          source_path?: string | null
          staff_note?: string | null
          status?: string
          subtotal?: number
          total?: number
          total_ils?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      cars: {
        Row: {
          code: string
          company_id: string
          content_html: string | null
          data: Json
          id: string
          image: string | null
          legacy_id: number | null
          max_people: number | null
          name: string
          position: number
          slug: string
        }
        Insert: {
          code: string
          company_id: string
          content_html?: string | null
          data?: Json
          id?: string
          image?: string | null
          legacy_id?: number | null
          max_people?: number | null
          name: string
          position?: number
          slug: string
        }
        Update: {
          code?: string
          company_id?: string
          content_html?: string | null
          data?: Json
          id?: string
          image?: string | null
          legacy_id?: number | null
          max_people?: number | null
          name?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
      cms_pages: {
        Row: {
          blocks: Json
          company_id: string
          content_html: string | null
          data: Json
          id: string
          is_active: boolean
          kind: string
          legacy_id: number | null
          path: string
          position: number
          seo: Json
          title: string
        }
        Insert: {
          blocks?: Json
          company_id: string
          content_html?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          kind?: string
          legacy_id?: number | null
          path: string
          position?: number
          seo?: Json
          title: string
        }
        Update: {
          blocks?: Json
          company_id?: string
          content_html?: string | null
          data?: Json
          id?: string
          is_active?: boolean
          kind?: string
          legacy_id?: number | null
          path?: string
          position?: number
          seo?: Json
          title?: string
        }
        Relationships: []
      }
      costing_lines: {
        Row: {
          component: string
          costing_id: string
          currency: string
          description: string | null
          id: string
          pax_type: string
          quantity: number
          source_ref: string | null
          supplier: string | null
          unit: string
          unit_cost: number
        }
        Insert: {
          component: string
          costing_id: string
          currency: string
          description?: string | null
          id?: string
          pax_type?: string
          quantity?: number
          source_ref?: string | null
          supplier?: string | null
          unit: string
          unit_cost: number
        }
        Update: {
          component?: string
          costing_id?: string
          currency?: string
          description?: string | null
          id?: string
          pax_type?: string
          quantity?: number
          source_ref?: string | null
          supplier?: string | null
          unit?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "costing_lines_costing_id_fkey"
            columns: ["costing_id"]
            isOneToOne: false
            referencedRelation: "costings"
            referencedColumns: ["id"]
          },
        ]
      }
      costings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assumptions: Json
          company_id: string
          created_at: string
          created_by: string | null
          departure_id: string | null
          id: string
          result: Json | null
          season_year: number | null
          series_id: string | null
          status: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assumptions?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          departure_id?: string | null
          id?: string
          result?: Json | null
          season_year?: number | null
          series_id?: string | null
          status?: string
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assumptions?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          departure_id?: string | null
          id?: string
          result?: Json | null
          season_year?: number | null
          series_id?: string | null
          status?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "costings_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departure_stats"
            referencedColumns: ["departure_id"]
          },
          {
            foreignKeyName: "costings_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      departure_options: {
        Row: {
          board: string | null
          company_id: string
          cost: number | null
          cost_currency: string | null
          departure_id: string
          id: string
          kind: string
          label: string | null
          max_people: number | null
          nights: number | null
          position: number
          price: number | null
          price_unit: string
          ref_code: string | null
          room_prices: Json | null
          stay_order: number | null
        }
        Insert: {
          board?: string | null
          company_id: string
          cost?: number | null
          cost_currency?: string | null
          departure_id: string
          id?: string
          kind: string
          label?: string | null
          max_people?: number | null
          nights?: number | null
          position?: number
          price?: number | null
          price_unit?: string
          ref_code?: string | null
          room_prices?: Json | null
          stay_order?: number | null
        }
        Update: {
          board?: string | null
          company_id?: string
          cost?: number | null
          cost_currency?: string | null
          departure_id?: string
          id?: string
          kind?: string
          label?: string | null
          max_people?: number | null
          nights?: number | null
          position?: number
          price?: number | null
          price_unit?: string
          ref_code?: string | null
          room_prices?: Json | null
          stay_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "departure_options_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departure_stats"
            referencedColumns: ["departure_id"]
          },
          {
            foreignKeyName: "departure_options_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      departure_prices: {
        Row: {
          company_id: string
          departure_id: string
          pax_type: string
          price: number
          room_position: number
        }
        Insert: {
          company_id: string
          departure_id: string
          pax_type: string
          price: number
          room_position: number
        }
        Update: {
          company_id?: string
          departure_id?: string
          pax_type?: string
          price?: number
          room_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "departure_prices_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departure_stats"
            referencedColumns: ["departure_id"]
          },
          {
            foreignKeyName: "departure_prices_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      departure_sales_entries: {
        Row: {
          company_id: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          departure_id: string
          docket_no: string | null
          entered_by: string | null
          flight_id: number | null
          id: string
          is_deleted: string | null
          lead_id: string | null
          note: string | null
          pax: number
        }
        Insert: {
          company_id: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          departure_id: string
          docket_no?: string | null
          entered_by?: string | null
          flight_id?: number | null
          id?: string
          is_deleted?: string | null
          lead_id?: string | null
          note?: string | null
          pax: number
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          departure_id?: string
          docket_no?: string | null
          entered_by?: string | null
          flight_id?: number | null
          id?: string
          is_deleted?: string | null
          lead_id?: string | null
          note?: string | null
          pax?: number
        }
        Relationships: [
          {
            foreignKeyName: "departure_sales_entries_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departure_stats"
            referencedColumns: ["departure_id"]
          },
          {
            foreignKeyName: "departure_sales_entries_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      departures: {
        Row: {
          arrival_airport: string | null
          baggage_included: boolean
          capacity: number | null
          card_badge: string | null
          child_max_age: number | null
          code: string
          company_id: string
          connection_back: string | null
          connection_out: string | null
          costing_id: string | null
          created_at: string
          currency: string
          data: Json
          date_labels: string[]
          docket_no: string | null
          end_date: string
          flight_mode: string
          flight_price: number
          id: string
          leader_id: string | null
          is_deleted: string | null
          is_published: boolean
          itinerary_id: string | null
          legacy_product_id: number | null
          markup_fixed: number | null
          markup_percent: number | null
          meal_included: boolean
          meeting_at: string | null
          notes: string | null
          origin_flight_id: number | null
          package_id: string
          price_source: string
          return_airport: string | null
          sale_status: string
          season: string | null
          season_id: string | null
          season_year: number
          senior_discount: number | null
          senior_min_age: number | null
          series_id: string
          site_id: number
          start_date: string
          transfers_included: boolean
          updated_at: string
        }
        Insert: {
          arrival_airport?: string | null
          baggage_included?: boolean
          capacity?: number | null
          card_badge?: string | null
          child_max_age?: number | null
          code: string
          company_id: string
          connection_back?: string | null
          connection_out?: string | null
          costing_id?: string | null
          created_at?: string
          currency?: string
          data?: Json
          date_labels?: string[]
          docket_no?: string | null
          end_date: string
          flight_mode?: string
          flight_price?: number
          id?: string
          leader_id?: string | null
          is_deleted?: string | null
          is_published?: boolean
          itinerary_id?: string | null
          legacy_product_id?: number | null
          markup_fixed?: number | null
          markup_percent?: number | null
          meal_included?: boolean
          meeting_at?: string | null
          notes?: string | null
          origin_flight_id?: number | null
          package_id: string
          price_source?: string
          return_airport?: string | null
          sale_status?: string
          season?: string | null
          season_id?: string | null
          season_year: number
          senior_discount?: number | null
          senior_min_age?: number | null
          series_id: string
          site_id?: number
          start_date: string
          transfers_included?: boolean
          updated_at?: string
        }
        Update: {
          arrival_airport?: string | null
          baggage_included?: boolean
          capacity?: number | null
          card_badge?: string | null
          child_max_age?: number | null
          code?: string
          company_id?: string
          connection_back?: string | null
          connection_out?: string | null
          costing_id?: string | null
          created_at?: string
          currency?: string
          data?: Json
          date_labels?: string[]
          docket_no?: string | null
          end_date?: string
          flight_mode?: string
          flight_price?: number
          id?: string
          leader_id?: string | null
          is_deleted?: string | null
          is_published?: boolean
          itinerary_id?: string | null
          legacy_product_id?: number | null
          markup_fixed?: number | null
          markup_percent?: number | null
          meal_included?: boolean
          meeting_at?: string | null
          notes?: string | null
          origin_flight_id?: number | null
          package_id?: string
          price_source?: string
          return_airport?: string | null
          sale_status?: string
          season?: string | null
          season_id?: string | null
          season_year?: number
          senior_discount?: number | null
          senior_min_age?: number | null
          series_id?: string
          site_id?: number
          start_date?: string
          transfers_included?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departures_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "package_itineraries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departures_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departures_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      flight_allocations: {
        Row: {
          company_id: string
          created_at: string
          departure_id: string
          flight_id: number
          id: string
          legs: string
          seats: number
        }
        Insert: {
          company_id: string
          created_at?: string
          departure_id: string
          flight_id: number
          id?: string
          legs?: string
          seats?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          departure_id?: string
          flight_id?: number
          id?: string
          legs?: string
          seats?: number
        }
        Relationships: [
          {
            foreignKeyName: "flight_allocations_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departure_stats"
            referencedColumns: ["departure_id"]
          },
          {
            foreignKeyName: "flight_allocations_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          amenities: string[]
          city: string | null
          code: string
          company_id: string
          content_html: string | null
          data: Json
          excerpt: string | null
          gallery: Json
          id: string
          image: string | null
          legacy_id: number | null
          name: string
          position: number
          slug: string
          stars: number | null
        }
        Insert: {
          amenities?: string[]
          city?: string | null
          code: string
          company_id: string
          content_html?: string | null
          data?: Json
          excerpt?: string | null
          gallery?: Json
          id?: string
          image?: string | null
          legacy_id?: number | null
          name: string
          position?: number
          slug: string
          stars?: number | null
        }
        Update: {
          amenities?: string[]
          city?: string | null
          code?: string
          company_id?: string
          content_html?: string | null
          data?: Json
          excerpt?: string | null
          gallery?: Json
          id?: string
          image?: string | null
          legacy_id?: number | null
          name?: string
          position?: number
          slug?: string
          stars?: number | null
        }
        Relationships: []
      }
      instructors: {
        Row: {
          company_id: string
          content_html: string | null
          data: Json
          excerpt: string | null
          gallery: Json
          id: string
          image: string | null
          is_active: boolean
          legacy_id: number | null
          name: string
          position: number
          regions: string | null
          slug: string
        }
        Insert: {
          company_id: string
          content_html?: string | null
          data?: Json
          excerpt?: string | null
          gallery?: Json
          id?: string
          image?: string | null
          is_active?: boolean
          legacy_id?: number | null
          name: string
          position?: number
          regions?: string | null
          slug: string
        }
        Update: {
          company_id?: string
          content_html?: string | null
          data?: Json
          excerpt?: string | null
          gallery?: Json
          id?: string
          image?: string | null
          is_active?: boolean
          legacy_id?: number | null
          name?: string
          position?: number
          regions?: string | null
          slug?: string
        }
        Relationships: []
      }
      package_itineraries: {
        Row: {
          arrival_city: string | null
          company_id: string
          days: Json
          id: string
          key: string
          label: string | null
          package_id: string
          return_city: string | null
        }
        Insert: {
          arrival_city?: string | null
          company_id: string
          days?: Json
          id?: string
          key?: string
          label?: string | null
          package_id: string
          return_city?: string | null
        }
        Update: {
          arrival_city?: string | null
          company_id?: string
          days?: Json
          id?: string
          key?: string
          label?: string | null
          package_id?: string
          return_city?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_itineraries_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_seasons: {
        Row: {
          attractions: string[] | null
          company_id: string
          created_at: string
          description_html: string | null
          gallery: string[] | null
          hero_image: string | null
          id: string
          included: string[] | null
          itinerary_id: string | null
          name: string
          not_included: string[] | null
          package_id: string
          position: number
          tags: string[]
          updated_at: string
        }
        Insert: {
          attractions?: string[] | null
          company_id: string
          created_at?: string
          description_html?: string | null
          gallery?: string[] | null
          hero_image?: string | null
          id?: string
          included?: string[] | null
          itinerary_id?: string | null
          name: string
          not_included?: string[] | null
          package_id: string
          position?: number
          tags?: string[]
          updated_at?: string
        }
        Update: {
          attractions?: string[] | null
          company_id?: string
          created_at?: string
          description_html?: string | null
          gallery?: string[] | null
          hero_image?: string | null
          id?: string
          included?: string[] | null
          itinerary_id?: string | null
          name?: string
          not_included?: string[] | null
          package_id?: string
          position?: number
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_seasons_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_terms: {
        Row: {
          package_id: string
          term_id: string
        }
        Insert: {
          package_id: string
          term_id: string
        }
        Update: {
          package_id?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_terms_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_terms_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          attractions: string[]
          brand: string
          cancellation_html: string | null
          card_image: string | null
          company_id: string
          countries: string | null
          created_at: string
          data: Json
          days: number | null
          description_html: string | null
          extra_info_html: string | null
          extra_sections: Json
          faq: Json
          gallery: string[]
          hero_image: string | null
          hotels: Json
          id: string
          instructor_ids: string[]
          included: string[]
          is_active: boolean
          is_deleted: string | null
          kind: string
          legacy_id: number | null
          name: string
          nights: number | null
          not_included: string[]
          seasons: string[]
          seo: Json
          slug: string
          subtitle: string | null
          terms_html: string | null
          updated_at: string
        }
        Insert: {
          attractions?: string[]
          brand?: string
          cancellation_html?: string | null
          card_image?: string | null
          company_id: string
          countries?: string | null
          created_at?: string
          data?: Json
          days?: number | null
          description_html?: string | null
          extra_info_html?: string | null
          extra_sections?: Json
          faq?: Json
          gallery?: string[]
          hero_image?: string | null
          hotels?: Json
          id?: string
          instructor_ids?: string[]
          included?: string[]
          is_active?: boolean
          is_deleted?: string | null
          kind?: string
          legacy_id?: number | null
          name: string
          nights?: number | null
          not_included?: string[]
          seasons?: string[]
          seo?: Json
          slug: string
          subtitle?: string | null
          terms_html?: string | null
          updated_at?: string
        }
        Update: {
          attractions?: string[]
          brand?: string
          cancellation_html?: string | null
          card_image?: string | null
          company_id?: string
          countries?: string | null
          created_at?: string
          data?: Json
          days?: number | null
          description_html?: string | null
          extra_info_html?: string | null
          extra_sections?: Json
          faq?: Json
          gallery?: string[]
          hero_image?: string | null
          hotels?: Json
          id?: string
          instructor_ids?: string[]
          included?: string[]
          is_active?: boolean
          is_deleted?: string | null
          kind?: string
          legacy_id?: number | null
          name?: string
          nights?: number | null
          not_included?: string[]
          seasons?: string[]
          seo?: Json
          slug?: string
          subtitle?: string | null
          terms_html?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promotions: {
        Row: {
          company_id: string
          departure_id: string | null
          id: string
          is_active: boolean
          kind: string
          label: string | null
          series_id: string | null
          show_on_card: boolean
          valid_until: string | null
          value: number | null
        }
        Insert: {
          company_id: string
          departure_id?: string | null
          id?: string
          is_active?: boolean
          kind: string
          label?: string | null
          series_id?: string | null
          show_on_card?: boolean
          valid_until?: string | null
          value?: number | null
        }
        Update: {
          company_id?: string
          departure_id?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          label?: string | null
          series_id?: string | null
          show_on_card?: boolean
          valid_until?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departure_stats"
            referencedColumns: ["departure_id"]
          },
          {
            foreignKeyName: "promotions_departure_id_fkey"
            columns: ["departure_id"]
            isOneToOne: false
            referencedRelation: "departures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      series: {
        Row: {
          arrival_airport: string | null
          arrival_weekday: number | null
          child_max_age: number
          code: string
          company_id: string
          default_capacity: number | null
          default_currency: string
          default_nights: number | null
          id: string
          is_active: boolean
          label: string | null
          package_id: string | null
          return_airport: string | null
          return_weekday: number | null
          senior_discount: number | null
          senior_min_age: number | null
        }
        Insert: {
          arrival_airport?: string | null
          arrival_weekday?: number | null
          child_max_age?: number
          code: string
          company_id: string
          default_capacity?: number | null
          default_currency?: string
          default_nights?: number | null
          id?: string
          is_active?: boolean
          label?: string | null
          package_id?: string | null
          return_airport?: string | null
          return_weekday?: number | null
          senior_discount?: number | null
          senior_min_age?: number | null
        }
        Update: {
          arrival_airport?: string | null
          arrival_weekday?: number | null
          child_max_age?: number
          code?: string
          company_id?: string
          default_capacity?: number | null
          default_currency?: string
          default_nights?: number | null
          id?: string
          is_active?: boolean
          label?: string | null
          package_id?: string | null
          return_airport?: string | null
          return_weekday?: number | null
          senior_discount?: number | null
          senior_min_age?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "series_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      series_terms: {
        Row: {
          series_id: string
          term_id: string
        }
        Insert: {
          series_id: string
          term_id: string
        }
        Update: {
          series_id?: string
          term_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_terms_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_terms_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          company_id: string
          data: Json
          description_html: string | null
          hero_images: string[]
          id: string
          is_active: boolean
          kind: string
          legacy_id: number | null
          name: string
          position: number
          slug: string
        }
        Insert: {
          company_id: string
          data?: Json
          description_html?: string | null
          hero_images?: string[]
          id?: string
          is_active?: boolean
          kind: string
          legacy_id?: number | null
          name: string
          position?: number
          slug: string
        }
        Update: {
          company_id?: string
          data?: Json
          description_html?: string | null
          hero_images?: string[]
          id?: string
          is_active?: boolean
          kind?: string
          legacy_id?: number | null
          name?: string
          position?: number
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      departure_stats: {
        Row: {
          allocated_seats: number | null
          company_id: string | null
          departure_id: string | null
          inbound_seats: number | null
          live_blocks: number | null
          outbound_seats: number | null
          remaining: number | null
          sold: number | null
          total_blocks: number | null
        }
        Relationships: []
      }
      flight_realization: {
        Row: {
          actual_cost: number | null
          airline_code: string | null
          company_id: string | null
          fees_paid: number | null
          groups_cancelled: number | null
          groups_ordered: number | null
          groups_realized: number | null
          month: string | null
          pax_ordered: number | null
          potential_cost: number | null
          seats_realized: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  c_megafamily: {
    Enums: {},
  },
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      price: ["NUMERIC(10, 2)"],
    },
  },
  tours: {
    Enums: {},
  },
} as const

