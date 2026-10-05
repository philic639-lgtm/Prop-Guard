/* global jest */
// Official AsyncStorage mock for Jest (persisted stores import it).
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
