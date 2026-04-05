import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import { useStore } from '../store/useStore';
import { getThemeColors, TYPOGRAPHY, SPACING, RADIUS } from '../constants/AppConstants';

const { width } = Dimensions.get('window');

export default function GlobalAlert() {
  const { alert, hideAlert, theme } = useStore();
  const colors = getThemeColors(theme);
  
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (alert) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleAnim.setValue(0.8);
      opacityAnim.setValue(0);
    }
  }, [alert]);

  if (!alert) return null;

  const handleButtonPress = (onPress?: () => void) => {
    if (onPress) onPress();
    hideAlert();
  };

  const getIcon = () => {
    switch (alert.type) {
      case 'success': return '✅';
      case 'danger': return '⚠️';
      case 'warning': return '🔔';
      default: return '💊';
    }
  };

  return (
    <Modal
      transparent
      visible={!!alert}
      animationType="none"
      onRequestClose={hideAlert}
    >
      <View style={styles.overlay}>
        <Animated.View 
          style={[
            styles.container, 
            { 
              backgroundColor: colors.surface,
              borderColor: colors.surfaceBorder,
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
            }
          ]}
        >
          <View style={styles.content}>
            <View style={[styles.iconContainer, { backgroundColor: colors.primary + '15' }]}>
              <Text style={styles.icon}>{getIcon()}</Text>
            </View>
            {alert.title && (
              <Text style={[styles.title, { color: colors.textPrimary }]}>{alert.title}</Text>
            )}
            <Text style={[styles.message, { color: colors.textSecondary }]}>{alert.message}</Text>
          </View>

          <View style={styles.buttonContainer}>
            {alert.buttons && alert.buttons.length > 0 ? (
              alert.buttons.map((btn, idx) => {
                const isDestructive = btn.style === 'destructive';
                const isCancel = btn.style === 'cancel';
                
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[
                      styles.button,
                      { borderTopColor: colors.surfaceBorder },
                      idx > 0 && { borderLeftColor: colors.surfaceBorder, borderLeftWidth: 1 },
                      isDestructive && { backgroundColor: colors.danger + '10' }
                    ]}
                    onPress={() => handleButtonPress(btn.onPress)}
                  >
                    <Text 
                      style={[
                        styles.buttonText, 
                        { color: isDestructive ? colors.danger : isCancel ? colors.textMuted : colors.primary }
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })
            ) : (
              <TouchableOpacity
                style={[styles.button, { borderTopColor: colors.surfaceBorder }]}
                onPress={hideAlert}
              >
                <Text style={[styles.buttonText, { color: colors.primary }]}>Tamam</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  container: {
    width: width * 0.85,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  content: {
    padding: SPACING.xxl,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  icon: {
    fontSize: 32,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSizeXl,
    fontWeight: TYPOGRAPHY.fontWeightBold,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  message: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row',
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
  },
  buttonText: {
    fontSize: TYPOGRAPHY.fontSizeMd,
    fontWeight: TYPOGRAPHY.fontWeightSemiBold,
  },
});
