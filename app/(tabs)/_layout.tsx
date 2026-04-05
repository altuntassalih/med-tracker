import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getThemeColors, SPACING, RADIUS } from '../../constants/AppConstants';
import { useStore } from '../../store/useStore';
import { t, LanguageCode } from '../../constants/translations';

interface TabIconProps {
  name: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  focused: boolean;
  colors: any;
}

function TabIcon({ name, label, focused, colors }: TabIconProps) {
  return (
    <View style={[
      styles.tabItem, 
      focused && { backgroundColor: colors.primary + '22' }
    ]}>
      <Ionicons 
        name={name} 
        size={focused ? 32 : 26} 
        color={focused ? colors.primaryLight : colors.textMuted} 
      />
      <Text 
        style={[
          styles.tabLabel, 
          { color: colors.textMuted },
          focused && { color: colors.primaryLight, fontWeight: '800', fontSize: 13 }
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { language, theme } = useStore();
  
  const colors = getThemeColors(theme);
  const lang = language as LanguageCode;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.primary + '44',
          borderTopWidth: 1,
          height: 100 + insets.bottom,
          paddingBottom: insets.bottom + 20,
          paddingTop: 15,
          elevation: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -10 },
          shadowOpacity: 0.1,
          shadowRadius: 10,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} label={t(lang, 'tabs.home')} focused={focused} colors={colors} />
          ),
        }}
      />
      <Tabs.Screen
        name="medicines"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'medical' : 'medical-outline'} label={t(lang, 'tabs.medicines')} focused={focused} colors={colors} />
          ),
        }}
      />
      <Tabs.Screen
        name="profiles"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'people' : 'people-outline'} label={t(lang, 'tabs.profile')} focused={focused} colors={colors} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'settings' : 'settings-outline'} label={t(lang, 'tabs.settings')} focused={focused} colors={colors} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.lg,
    gap: 4,
    minWidth: 90,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
