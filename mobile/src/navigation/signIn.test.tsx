import React from "react";
import { Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { navigationRef, openSignIn, signInOpen } from "./rootNavigation";

// Gast zuerst (#918): Anmelden und Registrieren liegen im Stapel über den Tabs. Derselbe Aufbau wie in der App -
// geprüft wird, dass der Weg von tief in einem Tab dorthin findet und danach genau dorthin zurückführt.

const Root = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const More = createNativeStackNavigator();

function Page({ name }: { name: string }) {
  return <Text>{`Seite ${name}`}</Text>;
}

function MoreStack() {
  return (
    <More.Navigator>
      <More.Screen name="MoreHub">{() => <Page name="MoreHub" />}</More.Screen>
      <More.Screen name="AdventCalendar">{() => <Page name="AdventCalendar" />}</More.Screen>
    </More.Navigator>
  );
}

function Main() {
  return (
    <Tabs.Navigator>
      <Tabs.Screen name="Dashboard">{() => <Page name="Dashboard" />}</Tabs.Screen>
      <Tabs.Screen name="More" component={MoreStack} />
    </Tabs.Navigator>
  );
}

async function renderApp() {
  await render(
    <NavigationContainer ref={navigationRef}>
      <Root.Navigator>
        <Root.Screen name="Main" component={Main} options={{ headerShown: false }} />
        <Root.Screen name="Login">{() => <Page name="Login" />}</Root.Screen>
        <Root.Screen name="Register">{() => <Page name="Register" />}</Root.Screen>
      </Root.Navigator>
    </NavigationContainer>,
  );
}

const current = () => navigationRef.getCurrentRoute()?.name;

test("aus dem Adventkalender zur Anmeldung - und danach genau dorthin zurück", async () => {
  await renderApp();
  await act(async () => {
    navigationRef.navigate("More", { screen: "AdventCalendar" } as never);
  });
  expect(current()).toBe("AdventCalendar");

  await act(async () => {
    expect(openSignIn()).toBe(true);
  });
  expect(current()).toBe("Login");
  expect(screen.getByText("Seite Login")).toBeTruthy();
  expect(signInOpen()).toBe(true);

  await act(async () => {
    navigationRef.goBack();
  });
  expect(current()).toBe("AdventCalendar");
  expect(signInOpen()).toBe(false);
});

test("Registrieren aus dem Hinweis: „Schon ein Konto?“ ersetzt die Seite durch Anmelden, zurück geht es zum Start", async () => {
  await renderApp();
  await act(async () => {
    openSignIn("Register");
  });
  expect(current()).toBe("Register");

  await act(async () => {
    navigationRef.dispatch({ type: "POP_TO", payload: { name: "Login" } });
  });
  expect(current()).toBe("Login");

  await act(async () => {
    navigationRef.goBack();
  });
  expect(current()).toBe("Dashboard");
});
