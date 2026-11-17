import { useSendWhatsApp } from "@agenteschat/client";
import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { Button, GroupedField, GroupedList, SheetScreen, Text, useFieldText, useToast } from "@/ui";
import { router } from "@/ui/navigation";
import { useColors, useOrgId } from "../shared/hooks";
import { openWhatsAppChat, useWhatsAppSay } from "./logic";
import { useWhatsAppWords } from "./words";

/** Digits a person types for a number, with or without "+", spaces and dashes. */
const digitsOf = (text: string) => text.replace(/\D/g, "");

/**
 * A new conversation from a number (the list's green "+"): the other person's number with its country code and the
 * first message, which starts it (the server refuses a number that isn't on WhatsApp, and holds a number to 20 new
 * conversations a day). Once sent it opens the conversation.
 */
export function WhatsAppNewChatScreen({ accountId }: { accountId: string }) {
  const w = useWhatsAppWords();
  const c = useColors();
  const words = useFieldText("body");
  const orgId = useOrgId();
  const toast = useToast();
  const say = useWhatsAppSay();
  const send = useSendWhatsApp(orgId, accountId);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const ready = digitsOf(phone).length >= 8 && text.trim().length > 0;
  const start = () => {
    if (!ready || send.isPending) return;
    send.mutate(
      { phone: digitsOf(phone), text: text.trim() },
      {
        onSuccess: ({ chatId }) => {
          router.back();
          openWhatsAppChat(accountId, chatId);
        },
        onError: (e) => toast({ title: say(e), icon: "x" }),
      },
    );
  };
  return (
    <SheetScreen>
      <Text variant="title">{w.list.newChat}</Text>
      <GroupedList>
        <GroupedField label={w.list.newChatPhone} stacked>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+55 11 99999-0000"
            placeholderTextColor={c.faint}
            keyboardType="phone-pad"
            autoFocus
            accessibilityLabel={w.list.newChatPhone}
            style={[styles.input, words, { color: c.ink }]}
          />
        </GroupedField>
        <GroupedField label={w.list.newChatText} stacked>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel={w.list.newChatText}
            style={[styles.input, styles.message, words, { color: c.ink }]}
          />
        </GroupedField>
      </GroupedList>
      <Button variant="primary" label={w.list.newChatSend} disabled={!ready} loading={send.isPending} onPress={start} />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  input: { paddingVertical: 4 },
  message: { minHeight: 72, textAlignVertical: "top" },
});
