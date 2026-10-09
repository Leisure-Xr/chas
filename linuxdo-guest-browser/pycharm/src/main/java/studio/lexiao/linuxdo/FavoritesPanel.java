package studio.lexiao.linuxdo;

import com.intellij.icons.AllIcons;
import com.intellij.openapi.Disposable;
import com.intellij.ui.JBColor;
import com.intellij.ui.SearchTextField;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBScrollPane;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.JBUI;

import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.*;
import java.awt.event.*;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Consumer;

/** Native favorites UI shared by the real popup and the visual regression fixture. */
final class FavoritesPanel extends JPanel implements Disposable {
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MM-dd HH:mm")
            .withZone(ZoneId.systemDefault());
    private final FavoritesViewModel model;
    private final Consumer<List<ReaderFavorites.Folder>> save;
    private final Consumer<String> open;
    private final Consumer<String> copy;
    private final Runnable close;
    private final SearchTextField search = new SearchTextField(false);
    private final JPanel tabs = new TabRows();
    private final Rows rows = new Rows();
    private final JBScrollPane scroll = new JBScrollPane(rows);
    private final JBLabel section = new JBLabel();
    private final JBLabel count = new JBLabel();
    private final JBLabel notice = new JBLabel();
    private final JButton manage = actionButton("", "管理当前目录", AllIcons.Actions.MoreHorizontal);
    private final JPanel editor = new JPanel(new BorderLayout(0, JBUI.scale(6)));
    private final JBLabel editorTitle = new JBLabel();
    private final JBTextField name = new JBTextField();
    private final JBLabel error = new JBLabel();
    private final JButton submit = actionButton("保存", "保存目录", null);
    private final DocumentListener searchListener;
    private final ComponentAdapter resizeListener = new ComponentAdapter() {
        @Override public void componentResized(ComponentEvent event) {
            tabs.revalidate();
            revalidate();
        }
    };
    private Component menuAnchor;
    private JPopupMenu menu;
    private String editMode;
    private String editFolderId;
    private Component editorReturnFocus;
    private boolean disposed;
    private int renderGeneration;

    FavoritesPanel(List<ReaderFavorites.Folder> folders, Consumer<List<ReaderFavorites.Folder>> save,
                   Consumer<String> open, Consumer<String> copy, Runnable close) {
        super(new BorderLayout(0, JBUI.scale(8)));
        this.model = new FavoritesViewModel(folders);
        this.save = save;
        this.open = open;
        this.copy = copy;
        this.close = close;
        setBorder(JBUI.Borders.empty(12));
        setMinimumSize(new Dimension(JBUI.scale(320), JBUI.scale(300)));
        JPanel top = new JPanel(new BorderLayout(0, JBUI.scale(10)));
        JPanel heading = new JPanel(new BorderLayout(JBUI.scale(8), 0));
        JBLabel title = new JBLabel("收藏夹");
        title.setFont(new javax.swing.plaf.FontUIResource(title.getFont().deriveFont(Font.BOLD)));
        heading.add(title, BorderLayout.CENTER);
        JButton create = actionButton("新建目录", "新建收藏目录", AllIcons.General.Add);
        create.putClientProperty("favorite.focus", "create");
        create.addActionListener(event -> showEditor("create"));
        heading.add(create, BorderLayout.EAST);
        top.add(heading, BorderLayout.NORTH);
        JPanel fields = new JPanel();
        fields.setLayout(new BoxLayout(fields, BoxLayout.Y_AXIS));
        search.getTextEditor().getEmptyText().setText("搜索所有目录、主题或链接");
        search.getTextEditor().getAccessibleContext().setAccessibleName("搜索收藏");
        search.setAlignmentX(LEFT_ALIGNMENT);
        fields.add(search);
        editor.setBorder(JBUI.Borders.emptyTop(8));
        editor.add(editorTitle, BorderLayout.NORTH);
        JPanel editorFields = new JPanel(new BorderLayout(0, JBUI.scale(4)));
        name.getAccessibleContext().setAccessibleName("目录名称");
        name.setColumns(1);
        editorFields.add(name, BorderLayout.NORTH);
        error.setForeground(JBColor.namedColor("Component.errorFocusColor", new JBColor(0xAF2929, 0xF28B82)));
        editorFields.add(error, BorderLayout.CENTER);
        JPanel editorActions = new JPanel(new FlowLayout(FlowLayout.TRAILING, JBUI.scale(4), 0));
        JButton cancel = actionButton("取消", "取消编辑", null);
        cancel.addActionListener(event -> hideEditor());
        submit.addActionListener(event -> submitEditor());
        name.addActionListener(event -> submitEditor());
        editorActions.add(cancel);
        editorActions.add(submit);
        editorFields.add(editorActions, BorderLayout.SOUTH);
        editor.add(editorFields, BorderLayout.CENTER);
        editor.setAlignmentX(LEFT_ALIGNMENT);
        editor.setVisible(false);
        fields.add(editor);
        top.add(fields, BorderLayout.CENTER);
        // Long libraries can scroll their wrapped tabs without displacing the topic list.
        JBScrollPane tabScroll = new JBScrollPane(tabs) {
            @Override public Dimension getPreferredSize() {
                Dimension size = tabs.getPreferredSize();
                return new Dimension(0, Math.min(JBUI.scale(110), size.height + JBUI.scale(2)));
            }
        };
        tabScroll.setBorder(JBUI.Borders.empty());
        tabScroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        tabScroll.getVerticalScrollBar().setUnitIncrement(JBUI.scale(24));
        top.add(tabScroll, BorderLayout.SOUTH);
        add(top, BorderLayout.NORTH);
        JPanel content = new JPanel(new BorderLayout(0, JBUI.scale(4)));
        JPanel subheading = new JPanel(new BorderLayout(JBUI.scale(4), 0));
        section.setForeground(secondary());
        section.setBorder(JBUI.Borders.empty(7, 0));
        subheading.setBorder(JBUI.Borders.customLine(JBColor.border(), 1, 0, 0, 0));
        subheading.add(section, BorderLayout.CENTER);
        manage.addActionListener(event -> showFolderMenu());
        manage.putClientProperty("favorite.focus", "manage");
        subheading.add(manage, BorderLayout.EAST);
        content.add(subheading, BorderLayout.NORTH);
        scroll.setBorder(JBUI.Borders.empty());
        scroll.setHorizontalScrollBarPolicy(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER);
        scroll.getVerticalScrollBar().setUnitIncrement(JBUI.scale(24));
        content.add(scroll, BorderLayout.CENTER);
        add(content, BorderLayout.CENTER);
        JPanel footer = new JPanel(new BorderLayout(0, JBUI.scale(4)));
        footer.setBorder(JBUI.Borders.compound(JBUI.Borders.customLine(JBColor.border(), 1, 0, 0, 0), JBUI.Borders.emptyTop(8)));
        count.setForeground(secondary());
        notice.setForeground(secondary());
        notice.setVisible(false);
        footer.add(notice, BorderLayout.NORTH);
        footer.add(count, BorderLayout.CENTER);
        add(footer, BorderLayout.SOUTH);
        searchListener = new DocumentListener() {
            private void changed() { model.search(search.getText()); render(false, false); }
            @Override public void insertUpdate(DocumentEvent event) { changed(); }
            @Override public void removeUpdate(DocumentEvent event) { changed(); }
            @Override public void changedUpdate(DocumentEvent event) { changed(); }
        };
        search.getTextEditor().getDocument().addDocumentListener(searchListener);
        getInputMap(WHEN_ANCESTOR_OF_FOCUSED_COMPONENT).put(KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), "favorites.escape");
        Action escape = new AbstractAction() {
            @Override public void actionPerformed(ActionEvent event) {
                if (!dismissTransient()) close.run();
            }
        };
        getActionMap().put("favorites.escape", escape);
        for (JTextField field : List.of(search.getTextEditor(), name)) {
            field.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), "favorites.escape");
            field.getActionMap().put("favorites.escape", escape);
        }
        addComponentListener(resizeListener);
        render(false, true);
    }

    JComponent preferredFocus() { return search.getTextEditor(); }

    private static Color secondary() {
        return new JBColor(() -> IdeThemePalette.current().muted());
    }

    private static JButton actionButton(String text, String accessibleName, Icon icon) {
        JButton button = new JButton(text, icon);
        button.setToolTipText(accessibleName);
        button.getAccessibleContext().setAccessibleName(accessibleName);
        button.setMargin(JBUI.insets(4, 7));
        if (text.isEmpty()) {
            button.setText("⋯");
            button.setIcon(null);
            button.setContentAreaFilled(false);
            button.putClientProperty("JButton.buttonType", "toolBarButton");
            button.setPreferredSize(JBUI.size(28, 28));
            button.setMinimumSize(JBUI.size(28, 28));
        }
        button.setFocusable(true);
        button.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "favorites.activate");
        button.getActionMap().put("favorites.activate", new AbstractAction() {
            @Override public void actionPerformed(ActionEvent event) { button.doClick(); }
        });
        return button;
    }

    boolean dismissTransient() {
        if (menu != null && menu.isVisible()) { menu.setVisible(false); return true; }
        if (editor.isVisible()) { hideEditor(); return true; }
        return false;
    }

    private void render(boolean keepScroll, boolean rebuildTabs) {
        if (disposed) return;
        int generation = ++renderGeneration;
        int position = keepScroll ? scroll.getVerticalScrollBar().getValue() : 0;
        Component focus = KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner();
        Object focusKey = focus instanceof JComponent component ? component.getClientProperty("favorite.focus") : null;
        if (rebuildTabs) {
            tabs.removeAll();
            addTab(null, "全部收藏", model.total());
            for (ReaderFavorites.Folder folder : model.folders()) addTab(folder.id(), folder.name(), folder.items().size());
            tabs.revalidate();
        }
        List<FavoritesViewModel.Row> visible = model.rows();
        ReaderFavorites.Folder selected = model.selected();
        String label = model.searching() ? "搜索结果" : selected == null ? "全部收藏" : selected.name();
        section.setText(shorten(label, 22) + " · " + visible.size() + " 个主题");
        section.setToolTipText(label + " · " + visible.size() + " 个主题");
        // The padded section label keeps the subheading height stable without an empty menu button.
        manage.setVisible(selected != null && !model.searching());
        rows.removeAll();
        if (visible.isEmpty()) {
            JBLabel empty = new JBLabel(model.searching() ? "没有匹配的收藏" : selected == null ? "还没有收藏主题" : "这个目录还是空的", SwingConstants.CENTER);
            empty.setForeground(secondary());
            empty.setBorder(JBUI.Borders.empty(32, 0));
            empty.setAlignmentX(LEFT_ALIGNMENT);
            empty.setMaximumSize(new Dimension(Integer.MAX_VALUE, empty.getPreferredSize().height));
            rows.add(empty);
        } else {
            for (FavoritesViewModel.Row entry : visible) rows.add(topicRow(entry));
        }
        count.setText(model.folders().size() + " 个目录 · " + model.total() + " 个主题");
        rows.revalidate();
        rows.repaint();
        revalidate();
        SwingUtilities.invokeLater(() -> {
            if (disposed || generation != renderGeneration) return;
            scroll.getVerticalScrollBar().setValue(position);
            // Search focus survives naturally; restore only controls replaced by rendering.
            if (focusKey != null && (focus == null || !SwingUtilities.isDescendingFrom(focus, this))) {
                JComponent replacement = findFocus(this, focusKey);
                if (replacement != null && replacement.isEnabled()) replacement.requestFocusInWindow();
                else search.getTextEditor().requestFocusInWindow();
            }
        });
    }

    private static JComponent findFocus(Container parent, Object key) {
        for (Component child : parent.getComponents()) {
            if (child instanceof JComponent component && key.equals(component.getClientProperty("favorite.focus"))) return component;
            if (child instanceof Container container) {
                JComponent result = findFocus(container, key);
                if (result != null) return result;
            }
        }
        return null;
    }

    private void addTab(String id, String label, int number) {
        JToggleButton tab = new JToggleButton(shorten(label, 8) + "  " + number, Objects.equals(id, model.selectedId())) {
            @Override protected void paintBorder(Graphics graphics) {
                if (hasFocus()) {
                    Graphics g = graphics.create();
                    g.setColor(JBColor.namedColor("Component.focusColor", new JBColor(0x3574F0, 0x6F9AE8)));
                    g.drawRect(0, 0, getWidth() - 1, getHeight() - 1);
                    g.dispose();
                }
            }
        };
        tab.setToolTipText(label + " · " + number + " 个主题");
        tab.getAccessibleContext().setAccessibleName(label + " " + number);
        tab.putClientProperty("favorite.focus", "folder:" + id);
        tab.setMargin(JBUI.insets(4, 7));
        tab.setContentAreaFilled(false);
        tab.setBorderPainted(true);
        tab.setOpaque(tab.isSelected());
        if (tab.isSelected()) {
            tab.setBackground(JBColor.namedColor("List.selectionInactiveBackground", new JBColor(0xE8EDF6, 0x374353)));
            tab.setFont(new javax.swing.plaf.FontUIResource(tab.getFont().deriveFont(Font.BOLD)));
        }
        tab.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "pressed");
        tab.getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0, true), "released");
        tab.addActionListener(event -> {
            hideEditor();
            model.select(id);
            render(false, true);
        });
        tabs.add(tab);
    }

    private JPanel topicRow(FavoritesViewModel.Row entry) {
        JPanel row = new JPanel(new BorderLayout(JBUI.scale(8), 0)) {
            @Override public Dimension getMaximumSize() {
                return new Dimension(Integer.MAX_VALUE, getPreferredSize().height);
            }
        };
        row.setAlignmentX(LEFT_ALIGNMENT);
        row.setBorder(JBUI.Borders.compound(JBUI.Borders.customLine(JBColor.border(), 0, 0, 1, 0), JBUI.Borders.empty(12, 0)));
        TwoLineTitle title = new TwoLineTitle(entry.item().title());
        title.putClientProperty("favorite.focus", "open:" + entry.key());
        title.addActionListener(event -> open.accept(entry.item().url()));
        JPanel text = new JPanel(new BorderLayout(0, JBUI.scale(4)));
        text.add(title, BorderLayout.CENTER);
        JBLabel metadata = new JBLabel(entry.siteName() + "  ·  " + entry.folder().name() + "  ·  "
                + DATE.format(Instant.ofEpochMilli(entry.item().savedAt())) + " 收藏");
        metadata.setForeground(secondary());
        metadata.setToolTipText(metadata.getText());
        text.add(metadata, BorderLayout.SOUTH);
        row.add(text, BorderLayout.CENTER);
        JButton more = actionButton("", "主题操作：" + entry.item().title(), AllIcons.Actions.MoreHorizontal);
        more.putClientProperty("favorite.focus", "more:" + entry.key());
        more.addActionListener(event -> showTopicMenu(more, entry));
        JPanel actions = new JPanel(new BorderLayout());
        actions.add(more, BorderLayout.NORTH);
        row.add(actions, BorderLayout.EAST);
        return row;
    }

    private void showTopicMenu(JButton anchor, FavoritesViewModel.Row entry) {
        JPopupMenu popup = createTopicMenu(anchor, entry);
        popup.show(anchor, Math.max(0, anchor.getWidth() - popup.getPreferredSize().width), anchor.getHeight());
    }

    JPopupMenu createTopicMenu(Component anchor, FavoritesViewModel.Row entry) {
        menuAnchor = anchor;
        menu = new JPopupMenu();
        addMenuItem("打开主题", AllIcons.Actions.Forward, () -> open.accept(entry.item().url()));
        addMenuItem("复制链接", AllIcons.Actions.Copy, () -> {
            copy.accept(entry.item().url());
            notice.setText("链接已复制");
            notice.setVisible(true);
            revalidate();
        });
        menu.addSeparator();
        addMenuItem("移出此目录", AllIcons.General.Remove, () -> update(ReaderFavorites.remove(model.folders(), entry.folder().id(), entry.item().url())));
        return menu;
    }

    private void showFolderMenu() {
        if (model.selected() == null) return;
        JPopupMenu popup = createFolderMenu();
        popup.show(manage, Math.max(0, manage.getWidth() - popup.getPreferredSize().width), manage.getHeight());
    }

    JPopupMenu createFolderMenu() {
        menuAnchor = manage;
        menu = new JPopupMenu();
        addMenuItem("重命名目录", null, () -> showEditor("rename"));
        addMenuItem("删除目录…", null, () -> showEditor("delete"));
        return menu;
    }

    private void addMenuItem(String label, Icon icon, Runnable action) {
        JMenuItem item = new JMenuItem(label, icon);
        item.addActionListener(event -> {
            if (menuAnchor != null) menuAnchor.requestFocusInWindow();
            action.run();
        });
        menu.add(item);
    }

    private void showEditor(String mode) {
        if (menu != null) menu.setVisible(false);
        editorReturnFocus = KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner();
        ReaderFavorites.Folder selected = model.selected();
        if (!mode.equals("create") && selected == null) return;
        editMode = mode;
        editFolderId = selected == null ? null : selected.id();
        String heading = mode.equals("create") ? "新建目录" : mode.equals("rename") ? "重命名目录"
                : "删除“" + selected.name() + "”及其中 " + selected.items().size() + " 个收藏？";
        // Swing HTML is used only for wrapping confirmation text; user text is escaped.
        editorTitle.setText("<html>" + html(heading) + "</html>");
        name.setText(mode.equals("rename") ? selected.name() : "");
        name.setVisible(!mode.equals("delete"));
        error.setText("");
        submit.setText(mode.equals("delete") ? "删除目录" : "保存");
        submit.getAccessibleContext().setAccessibleName(submit.getText());
        editor.setVisible(true);
        revalidate();
        SwingUtilities.invokeLater(() -> {
            if (disposed || !editor.isVisible()) return;
            if (name.isVisible()) { name.requestFocusInWindow(); name.selectAll(); }
            else submit.requestFocusInWindow();
        });
    }

    private void hideEditor() {
        if (!editor.isVisible()) return;
        editor.setVisible(false);
        editMode = null;
        editFolderId = null;
        revalidate();
        if (editorReturnFocus != null && SwingUtilities.isDescendingFrom(editorReturnFocus, this)) editorReturnFocus.requestFocusInWindow();
        else search.getTextEditor().requestFocusInWindow();
    }

    private void submitEditor() {
        if (disposed || editMode == null) return;
        try {
            if (editMode.equals("create")) {
                String id = "folder-" + UUID.randomUUID().toString().replace("-", "");
                update(ReaderFavorites.createFolder(model.folders(), name.getText(), id, System.currentTimeMillis()));
                model.select(id);
                search.setText("");
                model.search("");
                render(false, true);
            } else if (editMode.equals("rename")) {
                update(ReaderFavorites.renameFolder(model.folders(), editFolderId, name.getText()));
            } else if (editMode.equals("delete")) {
                update(ReaderFavorites.deleteFolder(model.folders(), editFolderId));
            }
            hideEditor();
        } catch (IllegalArgumentException failure) {
            error.setText(failure.getMessage());
            revalidate();
        }
    }

    private void update(List<ReaderFavorites.Folder> updated) {
        save.accept(updated);
        model.replace(updated);
        render(true, true);
    }

    @Override public void dispose() {
        if (disposed) return;
        disposed = true;
        removeComponentListener(resizeListener);
        menuAnchor = null;
        search.getTextEditor().getDocument().removeDocumentListener(searchListener);
        if (menu != null) { menu.setVisible(false); menu.removeAll(); menu = null; }
        removeAll();
        editorReturnFocus = null;
    }

    private static String shorten(String value, int length) {
        int points = value.codePointCount(0, value.length());
        return points <= length ? value : value.substring(0, value.offsetByCodePoints(0, length - 1)) + "…";
    }

    private static String html(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** Uses text metrics instead of HTML preferred widths so long titles never widen the list. */
    private static final class TwoLineTitle extends JButton {
        private final String title;
        TwoLineTitle(String title) {
            super("");
            this.title = title;
            setHorizontalAlignment(LEFT);
            setContentAreaFilled(false);
            setBorderPainted(false);
            setMargin(JBUI.insets(2));
            setToolTipText(title);
            getAccessibleContext().setAccessibleName(title);
            getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "pressed");
            getInputMap().put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0, true), "released");
        }
        @Override public Dimension getPreferredSize() {
            return new Dimension(JBUI.scale(100), getFontMetrics(getFont()).getHeight() * 2 + JBUI.scale(4));
        }
        @Override protected void paintComponent(Graphics graphics) {
            super.paintComponent(graphics);
            Graphics2D g = (Graphics2D) graphics.create();
            g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
            g.setFont(getFont());
            g.setColor(getForeground());
            FontMetrics metrics = g.getFontMetrics();
            List<String> lines = wrapTitle(title, metrics, Math.max(1, getWidth() - JBUI.scale(4)));
            int y = JBUI.scale(2) + metrics.getAscent();
            for (String line : lines) { g.drawString(line, JBUI.scale(2), y); y += metrics.getHeight(); }
            if (hasFocus()) {
                g.setColor(JBColor.namedColor("Component.focusColor", new JBColor(0x3574F0, 0x6F9AE8)));
                g.drawRect(0, 0, getWidth() - 1, getHeight() - 1);
            }
            g.dispose();
        }
    }

    static List<String> wrapTitle(String title, FontMetrics metrics, int width) {
        ArrayList<String> lines = new ArrayList<>();
        String remaining = title;
        for (int row = 0; row < 2 && !remaining.isEmpty(); row++) {
            if (metrics.stringWidth(remaining) <= width) { lines.add(remaining); break; }
            int end = 0;
            while (end < remaining.length()) {
                int next = remaining.offsetByCodePoints(end, 1);
                String candidate = remaining.substring(0, next) + (row == 1 ? "…" : "");
                if (metrics.stringWidth(candidate) > width) break;
                end = next;
            }
            if (end == 0) { lines.add("…"); break; }
            lines.add(remaining.substring(0, end) + (row == 1 ? "…" : ""));
            remaining = remaining.substring(end);
        }
        return lines;
    }

    private static final class Rows extends JPanel implements Scrollable {
        Rows() { setLayout(new BoxLayout(this, BoxLayout.Y_AXIS)); }
        @Override public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
        @Override public int getScrollableUnitIncrement(Rectangle visible, int orientation, int direction) { return JBUI.scale(24); }
        @Override public int getScrollableBlockIncrement(Rectangle visible, int orientation, int direction) { return visible.height; }
        @Override public boolean getScrollableTracksViewportWidth() { return true; }
        @Override public boolean getScrollableTracksViewportHeight() { return false; }
    }

    private static final class TabRows extends JPanel implements Scrollable {
        TabRows() { super(new WrapLayout()); }
        @Override public Dimension getPreferredScrollableViewportSize() { return getPreferredSize(); }
        @Override public int getScrollableUnitIncrement(Rectangle visible, int orientation, int direction) { return JBUI.scale(28); }
        @Override public int getScrollableBlockIncrement(Rectangle visible, int orientation, int direction) { return visible.height; }
        @Override public boolean getScrollableTracksViewportWidth() { return true; }
        @Override public boolean getScrollableTracksViewportHeight() { return false; }
    }

    private static final class WrapLayout extends FlowLayout {
        WrapLayout() { super(FlowLayout.LEADING, JBUI.scale(4), JBUI.scale(4)); }
        @Override public Dimension preferredLayoutSize(Container target) {
            synchronized (target.getTreeLock()) {
                int width = target.getParent() == null ? 0 : target.getParent().getWidth();
                if (width <= 0) width = JBUI.scale(280);
                int available = Math.max(1, width - getHgap() * 2);
                int rowWidth = 0, rowHeight = 0, height = getVgap();
                for (Component child : target.getComponents()) {
                    if (!child.isVisible()) continue;
                    Dimension size = child.getPreferredSize();
                    if (rowWidth > 0 && rowWidth + getHgap() + size.width > available) {
                        height += rowHeight + getVgap(); rowWidth = 0; rowHeight = 0;
                    }
                    rowWidth += (rowWidth == 0 ? 0 : getHgap()) + size.width;
                    rowHeight = Math.max(rowHeight, size.height);
                }
                return new Dimension(width, height + rowHeight + getVgap());
            }
        }
        @Override public Dimension minimumLayoutSize(Container target) { return new Dimension(0, 0); }
    }
}
